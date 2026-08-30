import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

import { errorMessage } from "./format";
import type { WalletContractClient } from "./gateway";

export type TransactionStage =
  | "AWAITING_WALLET"
  | "SUBMITTED"
  | "CONSENSUS_IN_PROGRESS"
  | "CONSENSUS_ACCEPTED"
  | "CONFIRMING_CONTRACT_STATE"
  | "RECORDED"
  | "CONSENSUS_UNRESOLVED"
  | "STATE_CONFIRMATION_PENDING"
  | "WALLET_REJECTED"
  | "FAILED";

export interface TransactionProgress {
  stage: TransactionStage;
  hash?: string;
  detail?: string;
}

export const STAGE_LABELS: Record<TransactionStage, string> = {
  AWAITING_WALLET: "AWAITING WALLET",
  SUBMITTED: "SUBMITTED",
  CONSENSUS_IN_PROGRESS: "CONSENSUS IN PROGRESS",
  CONSENSUS_ACCEPTED: "CONSENSUS ACCEPTED",
  CONFIRMING_CONTRACT_STATE: "CONFIRMING CONTRACT STATE",
  RECORDED: "RECORDED",
  CONSENSUS_UNRESOLVED: "CONSENSUS UNRESOLVED",
  STATE_CONFIRMATION_PENDING: "STATE CONFIRMATION PENDING",
  WALLET_REJECTED: "WALLET REJECTED",
  FAILED: "FAILED",
};

export class TransactionFlowError extends Error {
  constructor(
    message: string,
    public readonly stage: TransactionStage,
    public readonly hash?: string,
  ) {
    super(message);
    this.name = "TransactionFlowError";
  }
}

export interface ExecuteWriteOptions {
  client: WalletContractClient;
  address: `0x${string}`;
  functionName: string;
  args: unknown[];
  expectedState: () => Promise<boolean>;
  onProgress: (progress: TransactionProgress) => void;
  confirmationAttempts?: number;
  confirmationIntervalMs?: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function executionResultName(receipt: unknown): unknown {
  if (receipt === null || typeof receipt !== "object") return false;
  return (receipt as { txExecutionResultName?: unknown }).txExecutionResultName;
}

function unresolvedMessage(result: unknown): string {
  if (result === ExecutionResult.FINISHED_WITH_ERROR || result === "FINISHED_WITH_ERROR") {
    return "Contract execution returned FINISHED_WITH_ERROR; the transaction is unresolved.";
  }
  if (result === ExecutionResult.NOT_VOTED || result === "NOT_VOTED") {
    return "Consensus returned NOT_VOTED; the transaction is unresolved.";
  }
  if (result === undefined || result === null) {
    return "Consensus receipt did not include an execution result; the transaction is unresolved.";
  }
  return "Consensus returned an unsupported execution result; the transaction is unresolved.";
}

export async function executeTruthfulWrite(options: ExecuteWriteOptions): Promise<string> {
  const {
    client,
    address,
    functionName,
    args,
    expectedState,
    onProgress,
    confirmationAttempts = 8,
    confirmationIntervalMs = 1500,
  } = options;

  onProgress({ stage: "AWAITING_WALLET" });
  let hash: `0x${string}`;
  try {
    hash = await client.writeContract({
      address,
      functionName,
      args,
      value: 0n,
    });
  } catch (error) {
    const message = errorMessage(error);
    onProgress({ stage: "WALLET_REJECTED", detail: message });
    throw new TransactionFlowError(message, "WALLET_REJECTED");
  }

  onProgress({ stage: "SUBMITTED", hash });
  onProgress({ stage: "CONSENSUS_IN_PROGRESS", hash });
  let receipt: unknown;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      interval: 1500,
      retries: 80,
    });
  } catch (error) {
    const message = errorMessage(error);
    onProgress({ stage: "CONSENSUS_UNRESOLVED", hash, detail: message });
    throw new TransactionFlowError(message, "CONSENSUS_UNRESOLVED", hash);
  }

  const result = executionResultName(receipt);
  if (result !== ExecutionResult.FINISHED_WITH_RETURN && result !== "FINISHED_WITH_RETURN") {
    const message = unresolvedMessage(result);
    onProgress({ stage: "CONSENSUS_UNRESOLVED", hash, detail: message });
    throw new TransactionFlowError(message, "CONSENSUS_UNRESOLVED", hash);
  }

  onProgress({ stage: "CONSENSUS_ACCEPTED", hash });
  onProgress({ stage: "CONFIRMING_CONTRACT_STATE", hash });
  for (let attempt = 0; attempt < confirmationAttempts; attempt += 1) {
    try {
      if (await expectedState()) {
        onProgress({ stage: "RECORDED", hash });
        return hash;
      }
    } catch {
      // A transient read failure is not proof of state. Continue until the bounded wait ends.
    }
    if (attempt + 1 < confirmationAttempts) await sleep(confirmationIntervalMs);
  }

  const message = "The transaction was accepted, but expected contract state is not readable yet.";
  onProgress({ stage: "STATE_CONFIRMATION_PENDING", hash, detail: message });
  throw new TransactionFlowError(message, "STATE_CONFIRMATION_PENDING", hash);
}
