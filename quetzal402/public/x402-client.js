import { x402Client } from 'https://esm.sh/@x402/core@2.22.0/client';
import { registerExactEvmScheme } from 'https://esm.sh/@x402/evm@2.22.0/exact/client';
import { wrapFetchWithPayment } from 'https://esm.sh/@x402/fetch@2.22.0';

export const NETWORK_STORAGE_KEY = 'quetzal402.network';

export const NETWORKS = {
    base: {
        id: 'base',
        caip2: 'eip155:8453',
        chainId: 8453,
        chainIdHex: '0x2105',
        name: 'Base',
        buttonText: 'Boost Vault (1 USDC)',
        statusText: 'Sending 1 USDC on Base Mainnet...',
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        rpcUrl: 'https://mainnet.base.org',
        explorer: 'https://basescan.org',
    },
    'base-sepolia': {
        id: 'base-sepolia',
        caip2: 'eip155:84532',
        chainId: 84532,
        chainIdHex: '0x14a34',
        name: 'Base Sepolia',
        buttonText: 'Boost Vault (1 Testnet USDC)',
        statusText: 'Sending 1 Testnet USDC on Base Sepolia...',
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        rpcUrl: 'https://sepolia.base.org',
        explorer: 'https://sepolia.basescan.org',
    },
};

export function getSelectedNetwork() {
    try {
        const saved = localStorage.getItem(NETWORK_STORAGE_KEY);
        if (NETWORKS[saved]) {
            return saved;
        }
    } catch {
        // Ignore storage errors and fall back to testnet.
    }
    return 'base-sepolia';
}

export function setSelectedNetwork(networkId) {
    const id = NETWORKS[networkId] ? networkId : 'base-sepolia';
    localStorage.setItem(NETWORK_STORAGE_KEY, id);
    return id;
}

export async function ensureWalletOnNetwork(ethereum, networkId) {
    const network = NETWORKS[networkId] || NETWORKS['base-sepolia'];

    try {
        await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: network.chainIdHex }],
        });
    } catch (err) {
        if (err.code !== 4902) {
            throw err;
        }
        await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
                chainId: network.chainIdHex,
                chainName: network.name,
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: [network.rpcUrl],
                blockExplorerUrls: [network.explorer],
            }],
        });
    }
}

function toClientEvmSigner(ethersSigner, address) {
    return {
        address,
        async signTypedData({ domain, types, primaryType, message }) {
            const typedTypes = { ...types };
            delete typedTypes.EIP712Domain;
            return ethersSigner.signTypedData(domain, typedTypes, message);
        },
    };
}

export async function createX402Client(ethersSigner) {
    const client = new x402Client();
    registerExactEvmScheme(client, {
        signer: toClientEvmSigner(ethersSigner, await ethersSigner.getAddress()),
    });
    return {
        fetch: wrapFetchWithPayment(fetch, client),
    };
}

export function depositUrl(networkId) {
    const network = NETWORKS[networkId] ? networkId : 'base-sepolia';
    return `/api/vault/deposit?network=${encodeURIComponent(network)}`;
}

export const USDC_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];
