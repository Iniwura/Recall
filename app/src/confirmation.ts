import { LIMITS } from "./constants";
import { sourcesMatchExactly } from "./format";
import type { Assessment, Batch } from "./types";

export interface RegistrationConfirmation {
  owner: string;
  manufacturer: string;
  productName: string;
  productModel: string;
  sku: string;
  lotNumber: string;
  batchCode: string;
  manufactureDate: string;
  productIdentifier: string;
  recallPolicy: string;
  evidenceSources: readonly string[];
}

export interface AssessmentConfirmation {
  batchId: number;
  title: string;
  notes: string;
  reviewer: string;
  evidenceSources: readonly string[];
  priorBatchAssessmentCount: number;
}

export function boundedNewRecordIds(
  beforeCount: number,
  afterCount: number,
  limit: number = LIMITS.confirmationScan,
): number[] {
  if (afterCount <= beforeCount) return [];
  const count = Math.min(afterCount - beforeCount, limit);
  return Array.from({ length: count }, (_, index) => beforeCount + index + 1);
}

export function batchMatchesRegistration(
  batch: Batch,
  expected: RegistrationConfirmation,
): boolean {
  return (
    batch.owner.toLowerCase() === expected.owner.toLowerCase() &&
    batch.manufacturer === expected.manufacturer &&
    batch.productName === expected.productName &&
    batch.productModel === expected.productModel &&
    batch.sku === expected.sku &&
    batch.lotNumber === expected.lotNumber &&
    batch.batchCode === expected.batchCode &&
    batch.manufactureDate === expected.manufactureDate &&
    batch.productIdentifier === expected.productIdentifier &&
    batch.recallPolicy === expected.recallPolicy &&
    sourcesMatchExactly(batch.evidenceSources, expected.evidenceSources)
  );
}

export function assessmentMatchesSubmission(
  assessment: Assessment,
  expected: AssessmentConfirmation,
): boolean {
  return (
    assessment.batchId === expected.batchId &&
    assessment.title === expected.title &&
    assessment.notes === expected.notes &&
    assessment.reviewer.toLowerCase() === expected.reviewer.toLowerCase() &&
    sourcesMatchExactly(assessment.evidenceUrls, expected.evidenceSources) &&
    assessment.sequenceNumber > expected.priorBatchAssessmentCount
  );
}

export function policyUpdateMatches(
  batch: Batch,
  previousVersion: number,
  submittedPolicy: string,
): boolean {
  return batch.policyVersion > previousVersion && batch.recallPolicy === submittedPolicy;
}

export function sourcesUpdateMatches(
  batch: Batch,
  previousVersion: number,
  submittedSources: readonly string[],
): boolean {
  return batch.sourceSetVersion > previousVersion && sourcesMatchExactly(batch.evidenceSources, submittedSources);
}
