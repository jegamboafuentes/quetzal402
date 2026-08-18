import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { createX402Server } from '@coinbase/cdp-sdk/x402';
import { paymentMiddlewareFromHTTPServer } from '@x402/express';
import { CdpClient } from '@coinbase/cdp-sdk';
import { createPublicClient, createWalletClient, encodeFunctionData, fallback, http } from 'viem';
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
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpcUrl: 'https://mainnet.base.org',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
    ],
  },
  'base-sepolia': {
    id: 'base-sepolia',
    chainId: 84532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrl: 'https://base-sepolia.drpc.org',
    rpcUrls: [
      'https://base-sepolia.drpc.org',
      'https://84532.rpc.thirdweb.com',
      'https://base-sepolia-rpc.publicnode.com',
      'https://sepolia.base.org',
    ],
  },
};

async function rpcRequest(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
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

async function verifyRpcChain(rpcUrl, expectedChainId) {
  const result = await rpcRequest(rpcUrl, 'eth_chainId');
  const chainId = Number.parseInt(result, 16);
  if (chainId !== expectedChainId) {
    throw new Error(`RPC chain mismatch (${chainId} != ${expectedChainId})`);
  }
}

async function ethCall(rpcUrl, expectedChainId, to, data) {
  await verifyRpcChain(rpcUrl, expectedChainId);
  return rpcRequest(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
}

function networkTransport(network) {
  const rpcUrls = network.rpcUrls || [network.rpcUrl];
  return fallback(rpcUrls.map((url) => http(url)));
}

function emptyLedger() {
  return {
    currentRecord: { score: 0 },
    lastRecord: null,
    pendingWithdrawTo: null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scoreToBeat(ledger) {
  return Math.max(
    Number(ledger?.currentRecord?.score) || 0,
    Number(ledger?.lastRecord?.score) || 0,
  );
}

async function waitForVaultIncrease(networkId, previous, expectedIncrease) {
  const target = Number(previous) + Number(expectedIncrease);
  let latest = Number(previous);
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    try {
      latest = await getReceiverUsdc(networkId);
      if (latest + 1e-6 >= target) {
        return latest;
      }
    } catch (err) {
      console.warn(`Vault balance poll failed: ${err.message || err}`);
    }
  }
  return latest;
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
    rawNetwork || process.env.DEFAULT_X402_NETWORK || 'base',
  ).toLowerCase();
  return NETWORKS[raw] ? raw : 'base';
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
      const result = await ethCall(rpcUrl, network.chainId, network.usdc, data);
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
  const currentScore = scoreToBeat(ledger);
  let vaultTotal = 0;
  try {
    vaultTotal = await getReceiverUsdc(network);
  } catch (err) {
    console.warn(`Could not read vault USDC: ${err.message || err}`);
  }

  return {
    vaultTotal,
    receiver,
    network,
    currentRecord: { score: currentScore },
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
  const transport = networkTransport(network);
  const walletClient = createWalletClient({
    account: signer.account,
    chain,
    transport,
  });
  const publicClient = createPublicClient({
    chain,
    transport,
  });
  const data = encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: 'transfer',
    args: [toAddress, toAtomicUsdc(amountUsdc)],
  });

  async function sendPayout() {
    const transactionHash = await walletClient.sendTransaction({
      to: network.usdc,
      data,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      timeout: 60_000,
    });
    if (receipt.status !== 'success') {
      throw new Error('Vault payout transaction reverted.');
    }
    return transactionHash;
  }

  try {
    const transactionHash = await sendPayout();
    console.log(`[withdraw] sent ${amountUsdc} USDC to ${toAddress} tx=${transactionHash}`);
    return { paid: true, transactionHash };
  } catch (err) {
    console.warn(`[withdraw] first attempt failed: ${err.shortMessage || err.message || err}`);
    await fundVaultGas(networkId);
    try {
      const transactionHash = await sendPayout();
      console.log(`[withdraw] retry sent ${amountUsdc} USDC to ${toAddress} tx=${transactionHash}`);
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
      'base',
  ).toLowerCase();
  const network = X402_NETWORKS[raw] ? raw : 'base';
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
        payToConfig: { type: 'address', evm: receiver },
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
    // Return 200 immediately so the x402 middleware can settle through Coinbase CDP.
    // Waiting for the vault here cancels settlement and USDC never moves.
    const vault = await vaultPayload(invoice.network);
    console.log(`[deposit] accepted ${invoice.amount} ${tokenLabel} on ${invoice.network}; CDP facilitator will settle after this response`);
    res.json({
      success: true,
      pendingSettlement: true,
      message: `Payment accepted. Coinbase CDP is settling ${invoice.amount} ${tokenLabel} into the vault...`,
      amount: invoice.amount,
      ...vault,
    });
  });

  app.post('/api/score/submit', async (req, res) => {
    const { walletAddress, score, inputLog, network: rawNetwork } = req.body || {};
    const network = parseNetwork(rawNetwork);
    const finalScore = Number(score);
    const ledger = ledgers[network];
    const currentScore = scoreToBeat(ledger);

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
    ledger.currentRecord = { score: finalScore };
    await saveLedgers();

    return res.json({
      success: true,
      claimed: true,
      message: `New record claimed! ${finalScore} points. Withdraw Prize is unlocked.`,
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
      return res.status(409).json({
        success: false,
        paid: false,
        message: 'The prize vault is empty, so there is nothing to withdraw. Boost the vault first.',
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
      return res.status(409).json({
        success: false,
        paid: false,
        skipped: true,
        message: 'This prize was already withdrawn. Boost the vault and beat the record again.',
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

    let vaultAfter = await vaultPayload(network);
    for (let i = 0; i < 6 && vaultAfter.vaultTotal + 1e-6 >= amount; i++) {
      await sleep(1500);
      vaultAfter = await vaultPayload(network);
    }

    const explorer = network === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org';
    const txNote = payout.transactionHash
      ? ` ${explorer}/tx/${payout.transactionHash}`
      : '';

    return res.json({
      success: true,
      paid: true,
      skipped: Boolean(payout.skipped),
      transactionHash: payout.transactionHash || null,
      message: payout.skipped
        ? 'Prize is already in the connected wallet.'
        : `Withdrew ${amount.toFixed(2)} USDC to your connected wallet.${txNote}`,
      ...vaultAfter,
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
