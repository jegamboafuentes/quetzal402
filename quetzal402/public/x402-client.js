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
        rpcUrls: [
            'https://mainnet.base.org',
            'https://base-rpc.publicnode.com',
        ],
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
        rpcUrl: 'https://base-sepolia.drpc.org',
        rpcUrls: [
            'https://base-sepolia.drpc.org',
            'https://84532.rpc.thirdweb.com',
            'https://base-sepolia-rpc.publicnode.com',
            'https://sepolia.base.org',
        ],
        explorer: 'https://sepolia.basescan.org',
    },
};

export function getNetworkRpcUrls(networkId) {
    const network = NETWORKS[networkId] || NETWORKS['base-sepolia'];
    return network.rpcUrls || [network.rpcUrl];
}

async function rpcRequest(rpcUrl, method, params = []) {
    const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
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

export async function readUsdcBalanceFromRpc(address, networkId) {
    const network = NETWORKS[networkId] || NETWORKS['base-sepolia'];
    const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0');
    const callData = `0x70a08231${paddedAddress}`;
    let lastError = null;

    for (const rpcUrl of getNetworkRpcUrls(networkId)) {
        try {
            await verifyRpcChain(rpcUrl, network.chainId);
            const result = await rpcRequest(rpcUrl, 'eth_call', [{ to: network.usdc, data: callData }, 'latest']);
            return BigInt(result);
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error(`Could not read USDC on ${network.name}.`);
}

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
    const currentChainId = await ethereum.request({ method: 'eth_chainId' });
    if (String(currentChainId).toLowerCase() === network.chainIdHex.toLowerCase()) {
        return;
    }

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
                rpcUrls: getNetworkRpcUrls(networkId),
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
