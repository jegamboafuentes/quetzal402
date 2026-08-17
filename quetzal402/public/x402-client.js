import { x402Client } from 'https://esm.sh/@x402/core@2.22.0/client';
import { registerExactEvmScheme } from 'https://esm.sh/@x402/evm@2.22.0/exact/client';
import { wrapFetchWithPayment } from 'https://esm.sh/@x402/fetch@2.22.0';

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
