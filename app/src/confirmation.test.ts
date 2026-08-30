import { describe, expect, it } from "vitest";

import {
  assessmentMatchesSubmission,
  batchMatchesRegistration,
  boundedNewRecordIds,
  policyUpdateMatches,
  sourcesUpdateMatches,
  type AssessmentConfirmation,
  type RegistrationConfirmation,
} from "./confirmation";
import type { Assessment, Batch } from "./types";

const batch: Batch = {
  batchId: 8,
  manufacturer: "Manufacturer",
  productName: "Product",
  productModel: "Model",
  sku: "SKU",
  lotNumber: "Lot",
  batchCode: "Batch",
  manufactureDate: "Date",
  productIdentifier: "Identifier",
  owner: "0x1111111111111111111111111111111111111111",
  identityCommitment: "identity",
  recallPolicy: "Policy",
  policyVersion: 2,
  evidenceSources: ["https://a.example", "https://b.example"],
  sourceSetVersion: 3,
  sealed: false,
  assessmentStarted: false,
  assessmentCount: 4,
  latestVerdict: "UNDETERMINED",
  latestBatchBinding: "UNBOUND",
  latestReasoning: "reasoning",
  latestEvidenceSummary: "summary",
  recallActive: false,
  active: true,
};

const registration: RegistrationConfirmation = {
  owner: "0x1111111111111111111111111111111111111111",
  manufacturer: "Manufacturer",
  productName: "Product",
  productModel: "Model",
  sku: "SKU",
  lotNumber: "Lot",
  batchCode: "Batch",
  manufactureDate: "Date",
  productIdentifier: "Identifier",
  recallPolicy: "Policy",
  evidenceSources: ["https://b.example", "https://a.example"],
};

const assessment: Assessment = {
  assessmentId: 12,
  batchId: 8,
  reviewer: "0x1111111111111111111111111111111111111111",
  title: "Review",
  notes: "Notes",
  evidenceUrls: ["https://b.example", "https://a.example"],
  verdict: "WATCH",
  batchBinding: "PARTIAL",
  reasoning: "reasoning",
  evidenceSummary: "summary",
  policyVersion: 2,
  sourceSetVersion: 3,
  evidenceCommitment: "commitment",
  sequenceNumber: 5,
};

describe("bounded post-write confirmation helpers", () => {
  it("scans only newly created IDs without assuming one sequential result", () => {
    expect(boundedNewRecordIds(5, 8)).toEqual([6, 7, 8]);
    expect(boundedNewRecordIds(5, 60, 3)).toEqual([6, 7, 8]);
  });

  it("requires every registered field, owner, policy, and canonical source", () => {
    expect(batchMatchesRegistration(batch, registration)).toBe(true);
    expect(batchMatchesRegistration({ ...batch, productName: "Other" }, registration)).toBe(false);
    expect(batchMatchesRegistration({ ...batch, evidenceSources: ["https://a.example"] }, registration)).toBe(false);
    expect(batchMatchesRegistration({ ...batch, owner: "0x2222222222222222222222222222222222222222" }, registration)).toBe(false);
  });

  it("requires the exact submitted assessment metadata and a new sequence", () => {
    const expected: AssessmentConfirmation = { batchId: 8, title: "Review", notes: "Notes", reviewer: registration.owner, evidenceSources: registration.evidenceSources, priorBatchAssessmentCount: 4 };
    expect(assessmentMatchesSubmission(assessment, expected)).toBe(true);
    expect(assessmentMatchesSubmission({ ...assessment, sequenceNumber: 4 }, expected)).toBe(false);
    expect(assessmentMatchesSubmission({ ...assessment, notes: "Different" }, expected)).toBe(false);
    expect(assessmentMatchesSubmission({ ...assessment, reviewer: "0x2222222222222222222222222222222222222222" }, expected)).toBe(false);
  });

  it("requires exact values as well as incremented versions for policy and sources", () => {
    expect(policyUpdateMatches({ ...batch, policyVersion: 3, recallPolicy: "Next" }, 2, "Next")).toBe(true);
    expect(policyUpdateMatches({ ...batch, policyVersion: 3, recallPolicy: "Other" }, 2, "Next")).toBe(false);
    expect(sourcesUpdateMatches({ ...batch, sourceSetVersion: 4, evidenceSources: ["https://c.example", "https://a.example"] }, 3, ["https://a.example", "https://c.example"])).toBe(true);
    expect(sourcesUpdateMatches({ ...batch, sourceSetVersion: 4 }, 3, ["https://c.example"])).toBe(false);
  });
});
