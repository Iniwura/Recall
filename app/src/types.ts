import type { Binding, Verdict } from "./constants";

export interface Batch {
  batchId: number;
  manufacturer: string;
  productName: string;
  productModel: string;
  sku: string;
  lotNumber: string;
  batchCode: string;
  manufactureDate: string;
  productIdentifier: string;
  owner: string;
  identityCommitment: string;
  recallPolicy: string;
  policyVersion: number;
  evidenceSources: string[];
  sourceSetVersion: number;
  sealed: boolean;
  assessmentStarted: boolean;
  assessmentCount: number;
  latestVerdict: Verdict;
  latestBatchBinding: Binding;
  latestReasoning: string;
  latestEvidenceSummary: string;
  recallActive: boolean;
  active: boolean;
}

export interface Assessment {
  assessmentId: number;
  batchId: number;
  reviewer: string;
  title: string;
  notes: string;
  evidenceUrls: string[];
  verdict: Verdict;
  batchBinding: Binding;
  reasoning: string;
  evidenceSummary: string;
  policyVersion: number;
  sourceSetVersion: number;
  evidenceCommitment: string;
  sequenceNumber: number;
}

export interface RegistryRow {
  batch: Batch | null;
  batchId: number;
  error?: string;
}

export interface ReadResult<T> {
  data: T | null;
  error?: string;
}

export interface BatchDetailData {
  batch: Batch | null;
  assessments: Assessment[];
  assessmentScanCapped: boolean;
  assessmentReadFailures: number;
  error?: string;
}

export interface AssessmentScan {
  count: number;
  assessments: Assessment[];
  capped: boolean;
  failedReads: number;
}
