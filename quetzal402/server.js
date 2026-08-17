import express from 'express';
import dotenv from 'dotenv';
import { createX402Server } from '@coinbase/cdp-sdk/x402';
import { paymentMiddlewareFromHTTPServer } from '@x402/express';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
let vaultTotal = 0;
const receiver = process.env.VAULT_RECEIVER_ADDRESS;
const hasRealReceiver = typeof receiver === 'string' && /^0x[a-fA-F0-9]{40}$/.test(receiver);
const hasCdpKeys =
  Boolean(process.env.CDP_API_KEY_ID) &&
  Boolean(process.env.CDP_API_KEY_SECRET) &&
  !String(process.env.CDP_API_KEY_ID).startsWith('your_') &&
  !String(process.env.CDP_API_KEY_SECRET).startsWith('your_');

async function main() {
  let payToEvmAddress;

  if (hasCdpKeys && hasRealReceiver) {
    const x402Server = await createX402Server({
      routes: {
        'POST /api/vault/deposit': {
          price: '$1.00',
          description: 'Vault boost: 1 USDC added to the prize pool',
          networks: ['eip155:8453'],
        },
      },
      payToConfig: { type: 'address', evm: receiver },
    });

    app.use(paymentMiddlewareFromHTTPServer(x402Server));
    payToEvmAddress = x402Server.payToEvmAddress;
  } else {
    console.warn(
      'x402 payments are disabled until .env has real CDP_API_KEY_ID, CDP_API_KEY_SECRET, and VAULT_RECEIVER_ADDRESS.',
    );
  }

  app.get('/api/vault', (req, res) => {
    res.json({ vaultTotal });
  });

  app.post('/api/vault/deposit', (req, res) => {
    vaultTotal += 1;
    res.json({
      success: true,
      message: 'The Feathered Serpent is pleased. 1 USDC added to the vault!',
      vaultTotal,
    });
  });

  app.listen(PORT, () => {
    console.log(`Quetzal402 Vault Server running on port ${PORT}`);
    if (payToEvmAddress) {
      console.log(`Receiving USDC on Base at ${payToEvmAddress}`);
    }
  });
}

main().catch((err) => {
  console.error('Failed to start Quetzal402 Vault Server:');
  console.error(err.message || err);
  process.exit(1);
});
