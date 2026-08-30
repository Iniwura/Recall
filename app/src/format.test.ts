import { describe, expect, it } from "vitest";

import { deriveActiveRecallCount, deriveBatchStatus, hostnameFromUrl, shortHash, sourcesMatchExactly } from "./format";
import type { Batch } from "./types";

const baseBatch: Batch = {
  batchId: 1,
  manufacturer: "CareFusion 213, LLC",
  productName: "BD ChloraPrep Clear",
  productModel: "1 mL Applicator",
  sku: "54365-400-31",
  lotNumber: "Lot 4032183",
  batchCode: "FDA Lot 4032183",
  manufactureDate: "",
  productIdentifier: "NDC 54365-400-31",
  owner: "0x0000000000000000000000000000000000000000",
  identityCommitment: "identity",
  recallPolicy: "policy",
  policyVersion: 1,
  evidenceSources: ["https://api.fda.gov"],
  sourceSetVersion: 1,
  sealed: true,
  assessmentStarted: true,
  assessmentCount: 1,
  latestVerdict: "AFFECTED",
  latestBatchBinding: "BOUND",
  latestReasoning: "reasoning",
  latestEvidenceSummary: "summary",
  recallActive: false,
  active: true,
};

describe("batch display helpers", () => {
  it("uses the actual recall_active field for the active status", () => {
    expect(deriveBatchStatus({ ...baseBatch, recallActive: true })).toBe("RECALL ACTIVE");
    expect(deriveBatchStatus({ ...baseBatch, recallActive: false })).toBe("WATCH");
  });

  it("preserves an explicit not-affected verdict when recall is inactive", () => {
    expect(deriveBatchStatus({ ...baseBatch, latestVerdict: "NOT_AFFECTED" })).toBe("NOT AFFECTED");
  });

  it("requires the complete frozen source set without depending on order", () => {
    expect(sourcesMatchExactly(["https://b", "https://a"], ["https://a", "https://b"])).toBe(true);
    expect(sourcesMatchExactly(["https://a"], ["https://a", "https://b"])).toBe(false);
  });

  it("formats provenance without hiding the full URL", () => {
    expect(hostnameFromUrl("https://api.fda.gov/drug/enforcement.json")).toBe("api.fda.gov");
    expect(shortHash("0x1234567890abcdef", 5, 4)).toBe("0x123…cdef");
  });

  it("does not present a bounded or failed registry scan as a total", () => {
    expect(deriveActiveRecallCount([{ batch: { ...baseBatch, recallActive: true }, batchId: 1 }], true)).toBeNull();
    expect(deriveActiveRecallCount([{ batch: null, batchId: 1, error: "read failed" }], false)).toBeNull();
    expect(deriveActiveRecallCount([{ batch: { ...baseBatch, recallActive: true }, batchId: 1 }], false)).toBe(1);
  });
});
