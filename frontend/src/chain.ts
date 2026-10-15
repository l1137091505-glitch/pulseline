import { BrowserProvider, Contract, JsonRpcProvider, formatEther, parseEther, type JsonRpcSigner } from "ethers";

export const BOT_CHAIN = {
  chainId: 677,
  chainIdHex: "0x2a5",
  name: "BOT Chain Mainnet",
  rpcUrl: "https://rpc.botchain.ai",
  explorer: "https://scan.botchain.ai",
  currency: { name: "BOT", symbol: "BOT", decimals: 18 },
};

export const CONTRACT_ADDRESS = (import.meta.env.VITE_PULSELINE_ADDRESS ?? "").trim();

export const MARKET_ABI = [
  "function marketCount() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function getMarket(uint256) view returns ((uint128 totalYes,uint128 totalNo,uint128 minStake,uint128 maxStake,uint64 openTime,uint64 closeTime,uint64 resolvedAt,uint16 feeBps,uint8 outcome,address creator,string question,string description,string resolutionSource,string resolutionEvidence))",
  "function getPosition(uint256,address) view returns ((uint8 side,bool claimed,uint128 amount))",
  "function claimable(uint256,address) view returns (uint256)",
  "function isCreator(address) view returns (bool)",
  "function isResolver(address) view returns (bool)",
  "function stake(uint256,uint8) payable",
  "function claim(uint256) returns (uint256)",
  "function createMarket(string,string,string,uint64,uint64,uint128,uint128) returns (uint256)",
  "function resolve(uint256,uint8,string)",
  "event PositionTaken(uint256 indexed marketId,address indexed user,uint8 side,uint256 amount,uint256 totalYes,uint256 totalNo)",
] as const;

export type Market = {
  id: number;
  question: string;
  description: string;
  source: string;
  evidence: string;
  totalYes: bigint;
  totalNo: bigint;
  minStake: bigint;
  maxStake: bigint;
  openTime: number;
  closeTime: number;
  resolvedAt: number;
  feeBps: number;
  outcome: number;
  creator: string;
  demo?: boolean;
};

export type Position = { side: number; claimed: boolean; amount: bigint; claimable: bigint };

const now = Math.floor(Date.now() / 1000);
export const DEMO_MARKETS: Market[] = [
  {
    id: 1,
    question: "Will BOT close above $0.35 this Friday?",
    description: "Resolves YES when the referenced closing price is strictly above $0.35.",
    source: "CoinGecko BOT/USD market page",
    evidence: "",
    totalYes: parseEther("1240"), totalNo: parseEther("735"), minStake: parseEther("1"), maxStake: parseEther("500"),
    openTime: now - 7200, closeTime: now + 16200, resolvedAt: 0, feeBps: 200, outcome: 0,
    creator: "0x0000000000000000000000000000000000000000", demo: true,
  },
  {
    id: 2,
    question: "Will BOT Chain process 25k transactions today?",
    description: "Resolves from the daily transaction count shown by BOT Chain Explorer.",
    source: "BOT Chain Explorer daily transactions",
    evidence: "",
    totalYes: parseEther("420"), totalNo: parseEther("510"), minStake: parseEther("1"), maxStake: parseEther("250"),
    openTime: now - 3600, closeTime: now + 28800, resolvedAt: 0, feeBps: 200, outcome: 0,
    creator: "0x0000000000000000000000000000000000000000", demo: true,
  },
  {
    id: 3,
    question: "Will BTC trade above $110k at 12:00 UTC?",
    description: "A short price market resolved against the stated UTC snapshot.",
    source: "CoinGecko BTC/USD market page",
    evidence: "Snapshot archived by resolver",
    totalYes: parseEther("890"), totalNo: parseEther("1150"), minStake: parseEther("2"), maxStake: parseEther("1000"),
    openTime: now - 86400, closeTime: now - 3600, resolvedAt: now - 1800, feeBps: 200, outcome: 2,
    creator: "0x0000000000000000000000000000000000000000", demo: true,
  },
];

export const readProvider = new JsonRpcProvider(BOT_CHAIN.rpcUrl);

export async function connectWallet(): Promise<{ provider: BrowserProvider; signer: JsonRpcSigner; address: string }> {
  const ethereum = (window as Window & { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!ethereum) throw new Error("No browser wallet detected. Install MetaMask or another EVM wallet.");
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BOT_CHAIN.chainIdHex }] });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
    if (code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BOT_CHAIN.chainIdHex,
        chainName: BOT_CHAIN.name,
        nativeCurrency: BOT_CHAIN.currency,
        rpcUrls: [BOT_CHAIN.rpcUrl],
        blockExplorerUrls: [BOT_CHAIN.explorer],
      }],
    });
  }
  const provider = new BrowserProvider(ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export function readContract() { return CONTRACT_ADDRESS ? new Contract(CONTRACT_ADDRESS, MARKET_ABI, readProvider) : null; }
export function writeContract(signer: JsonRpcSigner) { return new Contract(CONTRACT_ADDRESS, MARKET_ABI, signer); }
export function bot(value: bigint) { return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
export function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export function marketStatus(market: Market) {
  const timestamp = Math.floor(Date.now() / 1000);
  if (market.outcome === 1) return "YES WON";
  if (market.outcome === 2) return "NO WON";
  if (market.outcome === 3) return "VOID";
  if (timestamp < market.openTime) return "UPCOMING";
  if (timestamp >= market.closeTime) return "AWAITING RESULT";
  return "LIVE";
}
