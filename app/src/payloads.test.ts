import { describe, expect, it } from "vitest";

import { assessmentArgs, registerArgs, sourcesArgs } from "./payloads";

describe("contract write payloads", () => {
  it("keeps the exact register_batch positional argument order", () => {
    expect(registerArgs({
      manufacturer: "M",
      productName: "P",
      productModel: "Model",
      sku: "SKU",
      lotNumber: "Lot",
      batchCode: "Batch",
      manufactureDate: "Date",
      productIdentifier: "Identifier",
      recallPolicy: "Policy",
      evidenceSources: ["https://b", "https://a"],
    })).toEqual(["M", "P", "Model", "SKU", "Lot", "Batch", "Date", "Identifier", "Policy", ["https://a", "https://b"]]);
  });

  it("submits the complete frozen assessment source set canonically", () => {
    expect(assessmentArgs(7, "Title", "Notes", ["https://b", "https://a"])).toEqual([7n, "Title", "Notes", ["https://a", "https://b"]]);
  });

  it("uses bigint batch IDs for update and active writes", () => {
    expect(sourcesArgs(3, ["https://a"])).toEqual([3n, ["https://a"]]);
  });
});
