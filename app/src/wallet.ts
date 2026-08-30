import { NETWORK_CHAIN_ID, NETWORK_CHAIN_ID_HEX } from "./constants";

export interface Eip1193Request {
  method: string;
  params?: readonly unknown[];
}

export interface Eip1193Provider {
  request: (request: Eip1193Request) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export type WalletStatus = "unavailable" | "disconnected" | "connected" | "wrong-network";

export interface WalletState {
  provider: Eip1193Provider | null;
  address: string | null;
  chainId: number | null;
  status: WalletStatus;
  error?: string;
}

export const BRADBURY_CHAIN_PARAMS = {
  chainId: NETWORK_CHAIN_ID_HEX,
  chainName: "GenLayer Bradbury Testnet",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://rpc-bradbury.genlayer.com"],
  blockExplorerUrls: ["https://explorer-bradbury.genlayer.com/"],
} as const;

export function getInjectedProvider(): Eip1193Provider | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
}

export function parseChainId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch {
    return null;
  }
}

export function isBradburyChain(chainId: number | null): boolean {
  return chainId === NETWORK_CHAIN_ID;
}

export function validateFreshWalletState(
  state: Pick<WalletState, "address" | "chainId" | "status">,
  expectedAddress: string,
): string | null {
  if (!isWalletAddress(expectedAddress)) return "The displayed wallet account is invalid.";
  if (!isWalletAddress(state.address)) return "Wallet did not return a valid account.";
  if (state.status !== "connected" || !isBradburyChain(state.chainId)) {
    return "Connect the wallet on GenLayer Bradbury before writing.";
  }
  if (state.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    return "The connected wallet account changed. Review the account before writing.";
  }
  return null;
}

export function isWalletAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function walletAddressFromAccounts(accounts: readonly unknown[]): string | null {
  return isWalletAddress(accounts[0]) ? accounts[0] : null;
}

function errorCode(error: unknown): number | string | null {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" || typeof code === "string" ? code : null;
  }
  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Wallet request was rejected.";
}

export async function readWalletState(
  provider: Eip1193Provider,
): Promise<Pick<WalletState, "address" | "chainId" | "status">> {
  const [accountsValue, chainValue] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  const accounts = Array.isArray(accountsValue) ? accountsValue : [];
  const address = walletAddressFromAccounts(accounts);
  const chainId = parseChainId(chainValue);
  return {
    address,
    chainId,
    status: address
      ? isBradburyChain(chainId)
        ? "connected"
        : "wrong-network"
      : "disconnected",
  };
}

export async function ensureBradburyNetwork(provider: Eip1193Provider): Promise<void> {
  const current = parseChainId(await provider.request({ method: "eth_chainId" }));
  if (isBradburyChain(current)) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NETWORK_CHAIN_ID_HEX }],
    });
  } catch (error) {
    if (errorCode(error) !== 4902 && errorCode(error) !== "4902") {
      throw new Error(errorText(error));
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [BRADBURY_CHAIN_PARAMS],
    });
  }
  const verified = parseChainId(await provider.request({ method: "eth_chainId" }));
  if (!isBradburyChain(verified)) {
    throw new Error("Wallet remains on the wrong network. Select GenLayer Bradbury.");
  }
}

export async function connectWallet(provider: Eip1193Provider): Promise<WalletState> {
  const accountsValue = await provider.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(accountsValue) ? accountsValue : [];
  if (!walletAddressFromAccounts(accounts)) throw new Error("Wallet did not return an account.");
  await ensureBradburyNetwork(provider);
  const state = await readWalletState(provider);
  return { provider, ...state };
}

export function watchWallet(
  provider: Eip1193Provider,
  onAccountsChanged: (accounts: unknown[]) => void,
  onChainChanged: (chainId: unknown) => void,
): () => void {
  const accountsListener = (...args: unknown[]) => {
    onAccountsChanged(Array.isArray(args[0]) ? args[0] : []);
  };
  const chainListener = (...args: unknown[]) => onChainChanged(args[0]);
  provider.on?.("accountsChanged", accountsListener);
  provider.on?.("chainChanged", chainListener);
  return () => {
    provider.removeListener?.("accountsChanged", accountsListener);
    provider.removeListener?.("chainChanged", chainListener);
  };
}

export function shortAddress(value: string | null): string {
  if (!value) return "NOT CONNECTED";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
