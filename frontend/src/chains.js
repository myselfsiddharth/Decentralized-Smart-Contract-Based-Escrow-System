export const DEFAULT_CHAIN_ID = 80002;

export const CHAIN_META = {
  80002: {
    chainIdHex: "0x13882",
    chainName: "Polygon Amoy",
    networkType: "testnet",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://rpc-amoy.polygon.technology"],
    blockExplorerUrls: ["https://amoy.polygonscan.com"],
  },
  137: {
    chainIdHex: "0x89",
    chainName: "Polygon PoS",
    networkType: "mainnet",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorerUrls: ["https://polygonscan.com"],
  },
};

export function resolveConfiguredChainId(rawChainId) {
  const value = String(rawChainId ?? "").trim();
  if (!value) return DEFAULT_CHAIN_ID;

  const chainId = Number(value);
  if (!Number.isInteger(chainId) || !CHAIN_META[chainId]) {
    return DEFAULT_CHAIN_ID;
  }

  return chainId;
}

export function explorerTxUrl(chainId, txHash) {
  const meta = CHAIN_META[chainId];
  if (!meta?.blockExplorerUrls?.[0]) return null;
  return `${meta.blockExplorerUrls[0]}/tx/${txHash}`;
}
