import { describe, expect, it, vi } from "vitest";

import { executeTruthfulWrite, type TransactionProgress } from "./transaction";
import type { WalletContractClient } from "./gateway";

function mockClient(receipt: unknown): WalletContractClient {
  return {
    writeContract: vi.fn(async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`),
    waitForTransactionReceipt: vi.fn(async () => receipt),
  };
}

describe("truthful transaction confirmation", () => {
  it("does not report RECORDED when accepted state is not confirmed", async () => {
    const progress: TransactionProgress[] = [];
    const promise = executeTruthfulWrite({
      client: mockClient({ txExecutionResultName: "FINISHED_WITH_RETURN" }),
      address: "0x1111111111111111111111111111111111111111",
      functionName: "seal_batch",
      args: [1n],
      expectedState: async () => false,
      onProgress: (value) => progress.push(value),
      confirmationAttempts: 1,
      confirmationIntervalMs: 0,
    });
    await expect(promise).rejects.toMatchObject({ stage: "STATE_CONFIRMATION_PENDING" });
    expect(progress.map((value) => value.stage)).toContain("CONSENSUS_ACCEPTED");
    expect(progress.at(-1)?.stage).toBe("STATE_CONFIRMATION_PENDING");
    expect(progress.map((value) => value.stage)).not.toContain("RECORDED");
  });

  it("reports RECORDED only after the expected contract state is true", async () => {
    const progress: TransactionProgress[] = [];
    const hash = await executeTruthfulWrite({
      client: mockClient({ txExecutionResultName: "FINISHED_WITH_RETURN" }),
      address: "0x1111111111111111111111111111111111111111",
      functionName: "set_batch_active",
      args: [1n, true],
      expectedState: async () => true,
      onProgress: (value) => progress.push(value),
      confirmationAttempts: 1,
    });
    expect(hash).toMatch(/^0x/);
    expect(progress.at(-1)?.stage).toBe("RECORDED");
  });

  it("keeps unresolved consensus explicit", async () => {
    const progress: TransactionProgress[] = [];
    await expect(executeTruthfulWrite({
      client: mockClient({ txExecutionResultName: "NOT_VOTED" }),
      address: "0x1111111111111111111111111111111111111111",
      functionName: "seal_batch",
      args: [1n],
      expectedState: async () => true,
      onProgress: (value) => progress.push(value),
      confirmationAttempts: 1,
    })).rejects.toMatchObject({ stage: "CONSENSUS_UNRESOLVED" });
    expect(progress.at(-1)?.stage).toBe("CONSENSUS_UNRESOLVED");
  });

  it.each([
    ["FINISHED_WITH_ERROR", "Contract execution returned FINISHED_WITH_ERROR"],
    ["NOT_VOTED", "Consensus returned NOT_VOTED"],
    [undefined, "did not include an execution result"],
    ["UNKNOWN_RESULT", "unsupported execution result"],
  ])("does not confirm state for %s receipts", async (executionResult, message) => {
    const progress: TransactionProgress[] = [];
    const expectedState = vi.fn(async () => true);
    await expect(executeTruthfulWrite({
      client: mockClient(executionResult === undefined ? {} : { txExecutionResultName: executionResult }),
      address: "0x1111111111111111111111111111111111111111",
      functionName: "seal_batch",
      args: [1n],
      expectedState,
      onProgress: (value) => progress.push(value),
      confirmationAttempts: 1,
    })).rejects.toMatchObject({ stage: "CONSENSUS_UNRESOLVED", hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(expectedState).not.toHaveBeenCalled();
    expect(progress.at(-1)).toMatchObject({
      stage: "CONSENSUS_UNRESOLVED",
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      detail: expect.stringContaining(message),
    });
    expect(progress.some((value) => value.stage === "CONSENSUS_ACCEPTED")).toBe(false);
    expect(progress.some((value) => value.stage === "CONFIRMING_CONTRACT_STATE")).toBe(false);
  });

  it("retains the submitted hash when receipt polling becomes unresolved", async () => {
    const progress: TransactionProgress[] = [];
    const client = mockClient(null);
    client.waitForTransactionReceipt = vi.fn(async () => { throw new Error("provider timeout"); });
    await expect(executeTruthfulWrite({
      client,
      address: "0x1111111111111111111111111111111111111111",
      functionName: "seal_batch",
      args: [1n],
      expectedState: async () => true,
      onProgress: (value) => progress.push(value),
      confirmationAttempts: 1,
    })).rejects.toMatchObject({ stage: "CONSENSUS_UNRESOLVED", hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(progress.at(-1)?.hash).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });
});
