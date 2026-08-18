<div align="center">
  <img src="https://github.com/jegamboafuentes/quetzal402/blob/main/quetzal402/public/assets/quetzal402(2).png?raw=true" alt="Quetzal402 Logo" width="250" />
  
  # Quetzal402: The Feathered Ledger

  *An Aztec-themed Web3 arcade game powered by the x402 Protocol on the Base Network.*

  [![Base Network](https://img.shields.io/badge/Network-Base-blue)](https://base.org)
  [![USDC](https://img.shields.io/badge/Token-USDC-2775CA)](https://circle.com)
  [![Phaser.js](https://img.shields.io/badge/Engine-Phaser.js-31353F)](https://phaser.io/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

---

## 🐍 About The Game

**Quetzal402** takes the classic mechanics of retro Snake and elevates them with on-chain stakes. Players guide Quetzalcoatl, the Feathered Serpent, across a temple grid to consume Jade Stones and grow. 

However, this isn't just for a high score. The game features a **Crowdfunded USDC Prize Vault** secured by Coinbase's `x402` protocol. 
* **Spectators & Players** can "Boost the Vault" by depositing 1 USDC via the x402 HTTP payment toll.
* **The Champion** who breaks the all-time high score automatically drains the accumulated public vault directly to their wallet!

## ✨ Features

* **x402 Protocol Integration:** Intercepts API requests and responds with HTTP 402, generating a cryptographic invoice settled via the Coinbase Developer Platform (CDP) Facilitator.
* **Dynamic Network Switching:** Seamlessly toggle between **Base Mainnet** (Real USDC) and **Base Sepolia** (Testnet USDC) directly from the UI.
* **Anti-Cheat Engine:** Keystrokes and timestamps are logged on the client and sent to the Node.js backend to verify the legitimacy of high scores before paying out the vault.
* **Responsive Aztec UI:** Custom retro pixel-art aesthetic, glassmorphism panels, and full touch-screen support for mobile play.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, JavaScript, Phaser.js (v3), `ethers.js`, `@x402/client`
* **Backend:** Node.js, Express.js
* **Web3/Crypto:** `@coinbase/cdp-sdk`, `@x402/express`, Base Network, USDC

---

## 🚀 Getting Started (Local Development)

### Prerequisites
1. **Node.js** (v18 or higher)
2. A **Coinbase Developer Platform (CDP)** Account
3. A Web3 Wallet (e.g., MetaMask, Coinbase Wallet)

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/jegamboafuentes/quetzal402.git](https://github.com/jegamboafuentes/quetzal402.git)
   cd quetzal402

2.  Install dependencies:
    
    Bash
    
    ```
    npm install
    ```
    
3.  Create a `.env` file in the root directory and add your CDP API credentials and Vault receiver address:
    
    Code snippet
    
    ```
    # Coinbase Developer Platform Keys
    CDP_API_KEY_NAME="organizations/YOUR_ORG/projects/YOUR_PROJECT/apiKeys/YOUR_KEY"
    CDP_API_KEY_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
    
    # The Wallet Address that collects the vault funds
    VAULT_RECEIVER_ADDRESS="0xYourWalletAddressHere"
    PORT=3000
    ```
    
4.  Start the server:
    
    Bash
    
    ```
    npm start
    ```
    
    *(Or `node server.js`)*
    
5.  Open your browser and navigate to `http://localhost:3000`.
    

## 🧪 Testing on Base Sepolia

To test the x402 Vault Boost mechanics without spending real money:

1.  Switch the network toggle in the game UI to **Testnet (Sepolia)**.
    
2.  Ensure your browser wallet (MetaMask) is connected to the **Base Sepolia Testnet** (Chain ID: `84532`).
    
3.  Acquire **Testnet ETH** (for gas) from the [Coinbase Developer Faucet](https://portal.cdp.coinbase.com/products/faucet).
    
4.  Acquire **Testnet USDC** from the [Circle Faucet](https://faucet.circle.com/).
    
5.  Click **Boost Vault** and sign the `TransferWithAuthorization` request.
    

## 📜 Credits & Attribution

-   **Developed by:** [Metaverse Professional LLC](https://metaverseprofessional.tech/)
    
-   **Author:** Enrique Gamboa ([enriquegamboa.info](https://enriquegamboa.info))
    
-   **Repository:** [GitHub - jegamboafuentes/quetzal402](https://www.google.com/search?q=https://github.com/jegamboafuentes/quetzal402)
