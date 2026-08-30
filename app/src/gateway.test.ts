import { describe, expect, it } from "vitest";

import { parseAssessment, parseBatch } from "./gateway";

const validBatch = {
  batch_id: "1",
  manufacturer: "Manufacturer",
  product_name: "Product",
  product_model: "Model",
  sku: "SKU",
  lot_number: "Lot",
  batch_code: "Batch",
  manufacture_date: "Date",
  product_identifier: "Identifier",
  owner: "0x1111111111111111111111111111111111111111",
  identity_commitment: "identity",
  recall_policy: "Policy",
  policy_version: "1",
  evidence_sources: ["https://example.com"],
  source_set_version: "1",
  sealed: true,
  assessment_started: true,
  assessment_count: "1",
  latest_verdict: "WATCH",
  latest_batch_binding: "PARTIAL",
  latest_reasoning: "reasoning",
  latest_evidence_summary: "summary",
  recall_active: false,
  active: true,
};

const validAssessment = {
  assessment_id: "1",
  batch_id: "1",
  reviewer: "0x1111111111111111111111111111111111111111",
  title: "Title",
  notes: "Notes",
  evidence_urls: ["https://example.com"],
  verdict: "WATCH",
  batch_binding: "PARTIAL",
  reasoning: "reasoning",
  evidence_summary: "summary",
  policy_version: "1",
  source_set_version: "1",
  evidence_commitment: "commitment",
  sequence_number: "1",
};

describe("fail-closed contract response parsers", () => {
  it("parses valid batch and assessment objects", () => {
    expect(parseBatch(validBatch)?.batchId).toBe(1);
    expect(parseBatch(validBatch)?.recallActive).toBe(false);
    expect(parseAssessment(validAssessment)?.sequenceNumber).toBe(1);
  });

  it("keeps a null batch explicitly null", () => {
    expect(parseBatch(null)).toBeNull();
    expect(parseBatch(undefined)).toBeNull();
  });

  it.each([
    ["object", "not-an-object"],
    ["numeric field", { ...validBatch, batch_id: "9007199254740992" }],
    ["recall_active boolean", { ...validBatch, recall_active: "false" }],
    ["verdict", { ...validBatch, latest_verdict: "MAYBE" }],
    ["binding", { ...validBatch, latest_batch_binding: "UNKNOWN" }],
    ["evidence URL list", { ...validBatch, evidence_sources: ["https://example.com", 7] }],
  ])("rejects a malformed %s", (_, value) => {
    expect(() => parseBatch(value)).toThrow();
  });

  it("rejects malformed assessment fields too", () => {
    expect(() => parseAssessment({ ...validAssessment, sequence_number: "not-a-number" })).toThrow();
    expect(() => parseAssessment({ ...validAssessment, verdict: "UNKNOWN" })).toThrow();
  });
});
