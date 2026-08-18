import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { createX402Server } from '@coinbase/cdp-sdk/x402';
import { paymentMiddlewareFromHTTPServer } from '@x402/express';
import { CdpClient } from '@coinbase/cdp-sdk';
import { createWalletClient, encodeFunctionData, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const RECORDS_PATH = path.join(DATA_DIR, 'records.json');
const USDC_DECIMALS = 6;
const USDC_BALANCE_OF = '0x70a08231';
const USDC_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];
const NETWORKS = {
  base: {
    id: 'base',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpcUrl: 'https://mainnet.base.org',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
    ],
  },
  'base-sepolia': {
    id: 'base-sepolia',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
    rpcUrls: [
      'https://base-sepolia-rpc.publicnode.com',
      'https://84532.rpc.thirdweb.com',
      'https://sepolia.base.org',
    ],
  },
};

async function ethCall(rpcUrl, to, data) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  });
  const payload = await res.json();
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC error');
  }
  if (payload.result == null) {
    throw new Error('RPC returned no result');
  }
  return payload.result;
}

function emptyLedger() {
  return {
    currentRecord: { score: 0 },
    lastRecord: null,
    pendingWithdrawTo: null,
  };
}

let ledgers = {
  base: emptyLedger(),
  'base-sepolia': emptyLedger(),
};

const receiver = process.env.VAULT_RECEIVER_ADDRESS;
const hasRealReceiver = typeof receiver === 'string' && /^0x[a-fA-F0-9]{40}$/.test(receiver);
const hasCdpKeys =
  Boolean(process.env.CDP_API_KEY_ID) &&
  Boolean(process.env.CDP_API_KEY_SECRET) &&
  !String(process.env.CDP_API_KEY_ID).startsWith('your_') &&
  !String(process.env.CDP_API_KEY_SECRET).startsWith('your_');

const X402_NETWORKS = {
  base: {
    id: 'base',
    caip2: 'eip155:8453',
    label: 'Base Mainnet',
    environment: 'production',
  },
  'base-sepolia': {
    id: 'base-sepolia',
    caip2: 'eip155:84532',
    label: 'Base Sepolia',
    environment: 'development',
  },
};

function parseNetwork(rawNetwork) {
  const raw = String(
    rawNetwork || process.env.DEFAULT_X402_NETWORK || 'base-sepolia',
  ).toLowerCase();
  return NETWORKS[raw] ? raw : 'base-sepolia';
}

async function loadLedgers() {
  try {
    const raw = JSON.parse(await fs.readFile(RECORDS_PATH, 'utf8'));
    ledgers = {
      base: { ...emptyLedger(), ...raw.base },
      'base-sepolia': { ...emptyLedger(), ...raw['base-sepolia'] },
    };
  } catch {
    ledgers = {
      base: emptyLedger(),
      'base-sepolia': emptyLedger(),
    };
  }
}

async function saveLedgers() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RECORDS_PATH, JSON.stringify(ledgers, null, 2));
}

async function getReceiverUsdc(networkId) {
  if (!hasRealReceiver) {
    return 0;
  }

  const network = NETWORKS[parseNetwork(networkId)];
  const paddedAddress = receiver.slice(2).toLowerCase().padStart(64, '0');
  const data = `${USDC_BALANCE_OF}${paddedAddress}`;
  const rpcUrls = network.rpcUrls || [network.rpcUrl];
  let lastError = null;

  for (const rpcUrl of rpcUrls) {
    try {
      const result = await ethCall(rpcUrl, network.usdc, data);
      return Number(BigInt(result)) / 10 ** USDC_DECIMALS;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(lastError?.message || `Could not read USDC for ${network.id}`);
}

async function vaultPayload(networkId) {
  const network = parseNetwork(networkId);
  const ledger = ledgers[network];
  let vaultTotal = 0;
  try {
    vaultTotal = await getReceiverUsdc(network);
  } catch (err) {
    console.warn(err.message || err);
  }

  return {
    vaultTotal,
    receiver,
    network,
    currentRecord: ledger.currentRecord,
    lastRecord: ledger.lastRecord,
  };
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

function sameAddress(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function toAtomicUsdc(amount) {
  return BigInt(Math.round(Number(amount) * 10 ** USDC_DECIMALS));
}

function readVaultPrivateKey() {
  const raw = String(process.env.VAULT_RECEIVER_PRIVATE_KEY || '').trim();
  if (!raw || raw.startsWith('your_')) {
    return null;
  }
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

function getVaultSigner() {
  const privateKey = readVaultPrivateKey();
  if (!privateKey) {
    return null;
  }
  const account = privateKeyToAccount(privateKey);
  if (hasRealReceiver && !sameAddress(account.address, receiver)) {
    console.warn(
      `VAULT_RECEIVER_PRIVATE_KEY is for ${account.address}, but VAULT_RECEIVER_ADDRESS is ${receiver}.`,
    );
    return null;
  }
  return { privateKey, account };
}

async function fundVaultGas(networkId) {
  if (!hasCdpKeys || networkId !== 'base-sepolia' || !hasRealReceiver) {
    return;
  }
  try {
    const cdp = new CdpClient();
    await cdp.evm.requestFaucet({
      address: receiver,
      network: 'base-sepolia',
      token: 'eth',
    });
  } catch (err) {
    console.warn(`Vault ETH faucet skipped: ${err.message || err}`);
  }
}

async function payWinner(toAddress, networkId, amountUsdc) {
  if (amountUsdc <= 0) {
    return { paid: false, error: 'Vault is empty.' };
  }
  if (sameAddress(toAddress, receiver)) {
    return { paid: true, skipped: true };
  }

  const signer = getVaultSigner();
  if (!signer) {
    return {
      paid: false,
      error: 'Add VAULT_RECEIVER_PRIVATE_KEY to .env so the server can pay the winner. Use the private key of the vault wallet, not the winner wallet.',
    };
  }

  const network = NETWORKS[parseNetwork(networkId)];
  const chain = networkId === 'base' ? base : baseSepolia;
  const client = createWalletClient({
    account: signer.account,
    chain,
    transport: http(network.rpcUrl),
  });
  const data = encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: 'transfer',
    args: [toAddress, toAtomicUsdc(amountUsdc)],
  });

  try {
    const transactionHash = await client.sendTransaction({
      to: network.usdc,
      data,
    });
    return { paid: true, transactionHash };
  } catch (err) {
    await fundVaultGas(networkId);
    try {
      const transactionHash = await client.sendTransaction({
        to: network.usdc,
        data,
      });
      return { paid: true, transactionHash };
    } catch (retryErr) {
      return {
        paid: false,
        error: retryErr.shortMessage || retryErr.message || 'Vault payout failed. The vault wallet may need a little ETH for gas.',
      };
    }
  }
}

function parseDepositAmount(rawAmount) {
  const parsed = Number(rawAmount);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return '1.00';
  }
  return parsed.toFixed(2);
}

function vaultDepositPricing(req) {
  const raw = String(
    req.query?.network ||
      req.get?.('x-payment-network') ||
      process.env.DEFAULT_X402_NETWORK ||
      'base-sepolia',
  ).toLowerCase();
  const network = X402_NETWORKS[raw] ? raw : 'base-sepolia';
  const config = X402_NETWORKS[network];
  const amount = parseDepositAmount(req.body?.amount);

  return {
    amount,
    currency: 'USDC',
    network,
    caip2: config.caip2,
    label: config.label,
  };
}

function dynamicVaultPrice(context) {
  const body = context.adapter.getBody?.() || {};
  const amount = parseDepositAmount(body.amount);
  return `$${amount}`;
}

async function main() {
  await loadLedgers();
  let payToEvmAddress;
  const x402MiddlewareByNetwork = {};

  if (hasCdpKeys && hasRealReceiver) {
    for (const config of Object.values(X402_NETWORKS)) {
      const x402Server = await createX402Server({
        environment: config.environment,
        routes: {
          'POST /api/vault/deposit': {
            description: `Vault boost: custom USDC deposit (${config.label})`,
            accepts: {
              scheme: 'exact',
              network: config.caip2,
              payTo: receiver,
              price: dynamicVaultPrice,
            },
          },
        },
        payToConfig: { type: 'address', evm: receiver },
      });

      x402MiddlewareByNetwork[config.id] = paymentMiddlewareFromHTTPServer(x402Server);
      payToEvmAddress = x402Server.payToEvmAddress;
    }

    app.use((req, res, next) => {
      if (req.method !== 'POST' || req.path !== '/api/vault/deposit') {
        return next();
      }

      const invoice = vaultDepositPricing(req);
      const middleware = x402MiddlewareByNetwork[invoice.network];
      return middleware(req, res, next);
    });
  } else {
    console.warn(
      'x402 payments are disabled until .env has real CDP_API_KEY_ID, CDP_API_KEY_SECRET, and VAULT_RECEIVER_ADDRESS.',
    );
  }

  app.get('/api/vault', async (req, res) => {
    const network = parseNetwork(req.query?.network);
    res.json(await vaultPayload(network));
  });

  app.post('/api/vault/deposit', async (req, res) => {
    const invoice = vaultDepositPricing(req);
    const tokenLabel = invoice.network === 'base' ? 'USDC' : 'Testnet USDC';
    const vault = await vaultPayload(invoice.network);
    res.json({
      success: true,
      message: `The Feathered Serpent is pleased. ${invoice.amount} ${tokenLabel} added to the vault!`,
      amount: invoice.amount,
      ...vault,
    });
  });

  app.post('/api/score/submit', async (req, res) => {
    const { walletAddress, score, inputLog, network: rawNetwork } = req.body || {};
    const network = parseNetwork(rawNetwork);
    const finalScore = Number(score);
    const ledger = ledgers[network];
    const currentScore = Number(ledger.currentRecord?.score) || 0;

    if (!Number.isFinite(finalScore) || finalScore < 0) {
      return res.status(400).json({
        success: false,
        message: 'Score is invalid.',
        ...(await vaultPayload(network)),
      });
    }

    if (finalScore <= currentScore) {
      return res.json({
        success: false,
        claimed: false,
        message: currentScore === 0
          ? 'Score 0 does not claim the record. Eat a jade stone first.'
          : `You did not beat the current record of ${currentScore}.`,
        walletAddress,
        score: finalScore,
        inputLog,
        ...(await vaultPayload(network)),
      });
    }

    if (!isAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        claimed: false,
        message: 'Connect a wallet to claim the record.',
        score: finalScore,
        ...(await vaultPayload(network)),
      });
    }

    const vault = await vaultPayload(network);
    ledger.lastRecord = {
      score: finalScore,
      amount: vault.vaultTotal,
      walletAddress,
      paid: false,
      claimedAt: new Date().toISOString(),
    };
    ledger.currentRecord = { score: 0 };
    await saveLedgers();

    return res.json({
      success: true,
      claimed: true,
      message: `New record claimed! ${finalScore} points. The record resets to 0.`,
      walletAddress,
      score: finalScore,
      inputLog,
      ...(await vaultPayload(network)),
    });
  });

  app.post('/api/vault/withdraw', async (req, res) => {
    const { walletAddress, network: rawNetwork } = req.body || {};
    const network = parseNetwork(rawNetwork);
    const ledger = ledgers[network];

    if (!isAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Connect a wallet to withdraw.',
        ...(await vaultPayload(network)),
      });
    }

    const amount = (await vaultPayload(network)).vaultTotal;
    if (amount <= 0) {
      return res.json({
        success: false,
        paid: false,
        message: 'Vault is empty. Boost the vault first, then win to withdraw.',
        ...(await vaultPayload(network)),
      });
    }

    const winner = ledger.lastRecord?.walletAddress;
    if (!isAddress(winner)) {
      return res.status(403).json({
        success: false,
        paid: false,
        message: 'Win the game with this connected wallet first, then withdraw.',
        ...(await vaultPayload(network)),
      });
    }

    if (!sameAddress(walletAddress, winner)) {
      return res.status(403).json({
        success: false,
        paid: false,
        message: `This prize belongs to ${winner}. Connect that winner wallet, or beat the record with your current wallet.`,
        ...(await vaultPayload(network)),
      });
    }

    if (ledger.lastRecord.paid) {
      return res.json({
        success: true,
        paid: true,
        skipped: true,
        message: 'This prize was already withdrawn.',
        ...(await vaultPayload(network)),
      });
    }

    const payout = await payWinner(walletAddress, network, amount);
    if (!payout.paid) {
      return res.status(500).json({
        success: false,
        paid: false,
        message: payout.error || 'Could not pay the winner.',
        ...(await vaultPayload(network)),
      });
    }

    ledger.lastRecord = {
      ...ledger.lastRecord,
      amount,
      walletAddress,
      paid: true,
      txHash: payout.transactionHash || null,
      claimedAt: new Date().toISOString(),
    };
    ledger.pendingWithdrawTo = null;
    await saveLedgers();

    return res.json({
      success: true,
      paid: true,
      skipped: Boolean(payout.skipped),
      transactionHash: payout.transactionHash || null,
      message: payout.skipped
        ? 'Prize is already in the connected wallet.'
        : `Withdrew ${amount.toFixed(2)} USDC to your connected wallet.`,
      ...(await vaultPayload(network)),
    });
  });

  app.listen(PORT, () => {
    console.log(`Quetzal402 Vault Server running on port ${PORT}`);
    if (payToEvmAddress) {
      console.log(`Receiving USDC at ${payToEvmAddress} on Base and Base Sepolia`);
    }
    if (getVaultSigner()) {
      console.log('Winner withdraw is enabled: vault can pay the connected winner wallet.');
    } else {
      console.warn('Winner withdraw is off until .env has VAULT_RECEIVER_PRIVATE_KEY for the vault address.');
    }
  });
}

main().catch((err) => {
  console.error('Failed to start Quetzal402 Vault Server:');
  console.error(err.message || err);
  process.exit(1);
});
