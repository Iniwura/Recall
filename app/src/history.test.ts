import { describe, expect, it } from "vitest";

import { exactLatestAssessment, summarizeAssessmentReads } from "./history";
import type { Assessment } from "./types";

function assessment(id: number, sequence: number): Assessment {
  return {
    assessmentId: id,
    batchId: 1,
    reviewer: "0x1111111111111111111111111111111111111111",
    title: `Assessment ${id}`,
    notes: "notes",
    evidenceUrls: ["https://example.com"],
    verdict: "WATCH",
    batchBinding: "PARTIAL",
    reasoning: "reasoning",
    evidenceSummary: "summary",
    policyVersion: 1,
    sourceSetVersion: 1,
    evidenceCommitment: `commitment-${id}`,
    sequenceNumber: sequence,
  };
}

describe("truthful assessment history", () => {
  it("retains failed reads and sorts only readable records", () => {
    const result = summarizeAssessmentReads(3, [
      { assessment: assessment(3, 3), failed: false },
      { assessment: null, failed: true },
      { assessment: assessment(1, 1), failed: false },
    ], false);
    expect(result.failedReads).toBe(1);
    expect(result.assessments.map((value) => value.assessmentId)).toEqual([3, 1]);
    expect(result.capped).toBe(false);
  });

  it("never labels an older readable record as the latest", () => {
    expect(exactLatestAssessment([assessment(1, 1)], 2)).toBeNull();
    expect(exactLatestAssessment([assessment(1, 1), assessment(2, 2)], 2)?.assessmentId).toBe(2);
  });

  it("keeps a bounded scan visibly capped", () => {
    const result = summarizeAssessmentReads(101, [{ assessment: assessment(101, 101), failed: false }], true);
    expect(result.capped).toBe(true);
    expect(result.count).toBe(101);
  });
});
