import { describe, expect, it, vi } from "vitest";

import {
  BRADBURY_CHAIN_PARAMS,
  connectWallet,
  ensureBradburyNetwork,
  isBradburyChain,
  parseChainId,
  passiveWalletSyncFailureState,
  readWalletState,
  validateFreshWalletState,
  walletAddressFromAccounts,
  watchWallet,
  type Eip1193Provider,
} from "./wallet";

function provider(request: Eip1193Provider["request"]): Eip1193Provider {
  return { request };
}

describe("wallet boundary", () => {
  it("parses and verifies the pinned Bradbury chain", () => {
    expect(parseChainId("0x107d")).toBe(4221);
    expect(parseChainId("4221")).toBe(4221);
    expect(isBradburyChain(4221)).toBe(true);
    expect(isBradburyChain(1)).toBe(false);
  });

  it("reports a disconnected account and a wrong network distinctly", async () => {
    const state = await readWalletState(provider(async ({ method }) => method === "eth_accounts" ? ["0x1111111111111111111111111111111111111111"] : "0x1"));
    expect(state.address).toBe("0x1111111111111111111111111111111111111111");
    expect(state.status).toBe("wrong-network");
    const disconnected = await readWalletState(provider(async ({ method }) => method === "eth_accounts" ? [] : "0x107d"));
    expect(disconnected.status).toBe("disconnected");
  });

  it("switches to Bradbury and verifies the resulting chain", async () => {
    const methods: string[] = [];
    const result = await connectWallet(provider(async ({ method }) => {
      methods.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
      if (method === "eth_chainId") return "0x107d";
      return null;
    }));
    expect(result.status).toBe("connected");
    expect(methods).toContain("eth_requestAccounts");
    expect(methods).toContain("eth_chainId");
  });

  it("adds only the verified Bradbury network when the wallet reports unknown chain", async () => {
    let chain = "0x1";
    const request = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") throw { code: 4902 };
      if (method === "wallet_addEthereumChain") {
        expect(params?.[0]).toEqual(BRADBURY_CHAIN_PARAMS);
        chain = "0x107d";
      }
      return null;
    });
    await ensureBradburyNetwork({ request });
    expect(request).toHaveBeenCalledWith({ method: "wallet_addEthereumChain", params: [BRADBURY_CHAIN_PARAMS] });
  });

  it("forwards account and chain events and cleans up listeners", () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const providerInstance: Eip1193Provider = {
      request: async () => null,
      on: (event, listener) => listeners.set(event, listener),
      removeListener: (event) => listeners.delete(event),
    };
    const accounts = vi.fn();
    const chains = vi.fn();
    const stop = watchWallet(providerInstance, accounts, chains);
    listeners.get("accountsChanged")?.([]);
    listeners.get("chainChanged")?.("0x1");
    expect(accounts).toHaveBeenCalledWith([]);
    expect(chains).toHaveBeenCalledWith("0x1");
    stop();
    expect(listeners.size).toBe(0);
  });

  it("rejects an account change detected immediately before writing", () => {
    expect(validateFreshWalletState({ address: "0x2222222222222222222222222222222222222222", chainId: 4221, status: "connected" }, "0x1111111111111111111111111111111111111111")).toMatch(/account changed/i);
  });

  it("rejects a chain change detected immediately before writing", () => {
    expect(validateFreshWalletState({ address: "0x1111111111111111111111111111111111111111", chainId: 1, status: "wrong-network" }, "0x1111111111111111111111111111111111111111")).toMatch(/Bradbury/i);
  });

  it("normalizes malformed accountsChanged input to disconnected", () => {
    expect(walletAddressFromAccounts(["not-an-address"])).toBeNull();
    expect(walletAddressFromAccounts(["0x1111111111111111111111111111111111111111"])).toBe("0x1111111111111111111111111111111111111111");
  });

  it("accepts the unchanged connected Bradbury account", () => {
    expect(validateFreshWalletState({ address: "0x1111111111111111111111111111111111111111", chainId: 4221, status: "connected" }, "0x1111111111111111111111111111111111111111")).toBeNull();
  });

  it("does not turn a passive wallet sync failure into a global notice", () => {
    const state = passiveWalletSyncFailureState(provider(async () => { throw { code: -32000 }; }));
    expect(state).toEqual({ provider: state.provider, address: null, chainId: null, status: "disconnected" });
    expect(state.error).toBeUndefined();
  });
});
