import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

import {
  BINDINGS,
  CONTRACT_ADDRESS,
  LIMITS,
  VERDICTS,
} from "./constants";
import { errorMessage } from "./format";
import { summarizeAssessmentReads } from "./history";
import type { Assessment, AssessmentScan, Batch, BatchDetailData, RegistryRow } from "./types";
import type { Eip1193Provider } from "./wallet";

const readClient = createClient({ chain: testnetBradbury });

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown, label: string): RecordValue {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as RecordValue;
  }
  throw new Error(`${label} returned a malformed contract object.`);
}

function textField(record: RecordValue, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${label} returned a malformed ${key} field.`);
  }
  return value;
}

function optionalTextField(record: RecordValue, key: string, label: string): string {
  const value = record[key];
  if (value === null || value === undefined) return "";
  return textField(record, key, label);
}

function numberField(record: RecordValue, key: string, label: string): number {
  const value = record[key];
  try {
    if (typeof value !== "bigint" && typeof value !== "string" && typeof value !== "number") throw new Error();
    if (typeof value === "string" && value.trim() === "") throw new Error();
    const parsed = typeof value === "bigint" ? value : BigInt(String(value));
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
    return Number(parsed);
  } catch {
    throw new Error(`${label} returned a malformed ${key} field.`);
  }
}

function booleanField(record: RecordValue, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${label} returned a malformed ${key} field.`);
  }
  return value;
}

function stringListField(record: RecordValue, key: string, label: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} returned a malformed ${key} field.`);
  }
  return [...value];
}

function verdictField(record: RecordValue, key: string, label: string) {
  const value = textField(record, key, label);
  if (!VERDICTS.includes(value as (typeof VERDICTS)[number])) {
    throw new Error(`${label} returned an unknown verdict.`);
  }
  return value as Batch["latestVerdict"];
}

function bindingField(record: RecordValue, key: string, label: string) {
  const value = textField(record, key, label);
  if (!BINDINGS.includes(value as (typeof BINDINGS)[number])) {
    throw new Error(`${label} returned an unknown binding.`);
  }
  return value as Batch["latestBatchBinding"];
}

async function callRead(functionName: string, args: readonly unknown[] = []): Promise<unknown> {
  return readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never,
    jsonSafeReturn: true,
    transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
  });
}

export function parseBatch(value: unknown): Batch | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value, "get_batch");
  return {
    batchId: numberField(record, "batch_id", "get_batch"),
    manufacturer: textField(record, "manufacturer", "get_batch"),
    productName: textField(record, "product_name", "get_batch"),
    productModel: textField(record, "product_model", "get_batch"),
    sku: textField(record, "sku", "get_batch"),
    lotNumber: textField(record, "lot_number", "get_batch"),
    batchCode: textField(record, "batch_code", "get_batch"),
    manufactureDate: optionalTextField(record, "manufacture_date", "get_batch"),
    productIdentifier: optionalTextField(record, "product_identifier", "get_batch"),
    owner: textField(record, "owner", "get_batch"),
    identityCommitment: textField(record, "identity_commitment", "get_batch"),
    recallPolicy: textField(record, "recall_policy", "get_batch"),
    policyVersion: numberField(record, "policy_version", "get_batch"),
    evidenceSources: stringListField(record, "evidence_sources", "get_batch"),
    sourceSetVersion: numberField(record, "source_set_version", "get_batch"),
    sealed: booleanField(record, "sealed", "get_batch"),
    assessmentStarted: booleanField(record, "assessment_started", "get_batch"),
    assessmentCount: numberField(record, "assessment_count", "get_batch"),
    latestVerdict: verdictField(record, "latest_verdict", "get_batch"),
    latestBatchBinding: bindingField(record, "latest_batch_binding", "get_batch"),
    latestReasoning: textField(record, "latest_reasoning", "get_batch"),
    latestEvidenceSummary: textField(record, "latest_evidence_summary", "get_batch"),
    recallActive: booleanField(record, "recall_active", "get_batch"),
    active: booleanField(record, "active", "get_batch"),
  };
}

export function parseAssessment(value: unknown): Assessment | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value, "get_assessment");
  return {
    assessmentId: numberField(record, "assessment_id", "get_assessment"),
    batchId: numberField(record, "batch_id", "get_assessment"),
    reviewer: textField(record, "reviewer", "get_assessment"),
    title: textField(record, "title", "get_assessment"),
    notes: textField(record, "notes", "get_assessment"),
    evidenceUrls: stringListField(record, "evidence_urls", "get_assessment"),
    verdict: verdictField(record, "verdict", "get_assessment"),
    batchBinding: bindingField(record, "batch_binding", "get_assessment"),
    reasoning: textField(record, "reasoning", "get_assessment"),
    evidenceSummary: textField(record, "evidence_summary", "get_assessment"),
    policyVersion: numberField(record, "policy_version", "get_assessment"),
    sourceSetVersion: numberField(record, "source_set_version", "get_assessment"),
    evidenceCommitment: textField(record, "evidence_commitment", "get_assessment"),
    sequenceNumber: numberField(record, "sequence_number", "get_assessment"),
  };
}

export async function readBatchCount(): Promise<number> {
  return numberValue(await callRead("get_batch_count"), "get_batch_count");
}

export async function readAssessmentCount(): Promise<number> {
  return numberValue(await callRead("get_assessment_count"), "get_assessment_count");
}

function numberValue(value: unknown, label: string): number {
  try {
    if (typeof value !== "bigint" && typeof value !== "string" && typeof value !== "number") throw new Error();
    if (typeof value === "string" && value.trim() === "") throw new Error();
    const parsed = typeof value === "bigint" ? value : BigInt(String(value));
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
    return Number(parsed);
  } catch {
    throw new Error(`${label} returned an unavailable count.`);
  }
}

export async function readBatch(batchId: number): Promise<Batch | null> {
  return parseBatch(await callRead("get_batch", [BigInt(batchId)]));
}

export async function readAssessment(assessmentId: number): Promise<Assessment | null> {
  return parseAssessment(await callRead("get_assessment", [BigInt(assessmentId)]));
}

export async function readRecallActive(batchId: number): Promise<boolean> {
  const value = await callRead("recall_active", [BigInt(batchId)]);
  if (typeof value !== "boolean") throw new Error("recall_active returned a non-boolean value.");
  return value;
}

export async function loadRegistry(): Promise<{
  count: number;
  rows: RegistryRow[];
  capped: boolean;
}> {
  const count = await readBatchCount();
  const capped = count > LIMITS.registryScan;
  const ids = Array.from({ length: Math.min(count, LIMITS.registryScan) }, (_, index) => index + 1);
  const rows = await Promise.all(
    ids.map(async (batchId): Promise<RegistryRow> => {
      try {
        const batch = await readBatch(batchId);
        return batch
          ? { batchId, batch }
          : { batchId, batch: null, error: "Batch does not exist." };
      } catch (error) {
        return { batchId, batch: null, error: errorMessage(error) };
      }
    }),
  );
  return { count, rows, capped };
}

function assessmentIds(count: number): number[] {
  const firstId = Math.max(1, count - LIMITS.assessmentScan + 1);
  return Array.from(
    { length: count === 0 ? 0 : count - firstId + 1 },
    (_, index) => firstId + index,
  );
}

async function loadAssessmentScan(): Promise<AssessmentScan> {
  const count = await readAssessmentCount();
  const capped = count > LIMITS.assessmentScan;
  const outcomes = await Promise.all(
    assessmentIds(count).map(async (assessmentId) => {
      try {
        const assessment = await readAssessment(assessmentId);
        return { assessment, failed: assessment === null };
      } catch {
        return { assessment: null, failed: true };
      }
    }),
  );
  return summarizeAssessmentReads(count, outcomes, capped);
}

export async function loadAssessmentHistory(): Promise<AssessmentScan> {
  return loadAssessmentScan();
}

export async function loadAssessmentsForBatch(batchId: number): Promise<AssessmentScan> {
  const scan = await loadAssessmentScan();
  return {
    ...scan,
    assessments: scan.assessments.filter((assessment) => assessment.batchId === batchId),
  };
}

export async function loadBatchDetail(batchId: number): Promise<BatchDetailData> {
  const batch = await readBatch(batchId);
  if (!batch) {
    return {
      batch: null,
      assessments: [],
      assessmentScanCapped: false,
      assessmentReadFailures: 0,
    };
  }
  const result = await loadAssessmentsForBatch(batchId);
  return {
    batch,
    assessments: result.assessments,
    assessmentScanCapped: result.capped,
    assessmentReadFailures: result.failedReads,
  };
}

export interface WalletContractClient {
  writeContract: (args: {
    address: `0x${string}`;
    functionName: string;
    args?: unknown[];
    value: bigint;
  }) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (args: {
    hash: `0x${string}`;
    status?: string;
    interval?: number;
    retries?: number;
  }) => Promise<unknown>;
}

export function createWalletClient(
  provider: Eip1193Provider,
  address: string,
): WalletContractClient {
  return createClient({
    chain: testnetBradbury,
    account: address as `0x${string}`,
    provider: provider as never,
  }) as unknown as WalletContractClient;
}

export { CONTRACT_ADDRESS, EXPLORER_URL, NETWORK_NAME, RPC_URL } from "./constants";
