import express from 'express';
import dotenv from 'dotenv';
import { createX402Server, createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import { withPayment } from '@x402/express';

dotenv.config();

const app = express();
app.use(express.json());

// 1. Initialize the CDP Facilitator
// This acts on your behalf to verify and settle USDC payments on Base
const facilitator = createCdpFacilitatorClient();

// 2. Configure the x402 Server instance
const x402Server = createX402Server({
  facilitator,
  // Your vault address where the USDC will be collected
  receiver: process.env.VAULT_RECEIVER_ADDRESS,
});

// 3. Define the pricing logic for the Vault Deposit
// We charge 1 USDC on the Base network for every vault boost
const vaultDepositPricing = async (req) => {
  return {
    amount: "1.00", 
    currency: "USDC",
    network: "base"
  };
};

// 4. Wrap the deposit endpoint with the x402 middleware
// If the user hasn't paid, this automatically responds with HTTP 402!
app.post(
  '/api/vault/deposit',
  withPayment(x402Server, vaultDepositPricing),
  (req, res) => {
    // If the code reaches here, the CDP Facilitator confirmed the 1 USDC payment.
    // The proof of payment is attached to req.paymentReceipt
    
    const receipt = req.paymentReceipt;
    console.log(`Vault boosted! Receipt ID: ${receipt.id}`);
    
    // TODO: Update your database here to increase the accumulated prize pool by $1
    
    res.json({
      success: true,
      message: "The Feathered Serpent is pleased. 1 USDC added to the vault!",
      newVaultTotal: "Calculate this from DB",
      receipt: receipt.id
    });
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Quetzal402 Vault Server running on port ${PORT}`);
});