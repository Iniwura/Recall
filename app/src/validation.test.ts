import { describe, expect, it } from "vitest";

import { validateEvidenceSources, validateRecallPolicy } from "./validation";

describe("browser input validation", () => {
  it("rejects duplicate URLs after canonical trimming", () => {
    expect(validateEvidenceSources(["https://example.com/a", " https://example.com/a "]).error).toMatch(/duplicates/i);
  });

  it("rejects more than four sources", () => {
    expect(validateEvidenceSources(["https://a", "https://b", "https://c", "https://d", "https://e"]).error).toMatch(/4/);
  });

  it("rejects whitespace inside a URL", () => {
    expect(validateEvidenceSources(["https://example.com/a b"]).error).toMatch(/whitespace/i);
  });

  it("rejects non-http URLs", () => {
    expect(validateEvidenceSources(["ftp://example.com/file"]).error).toMatch(/HTTP/i);
  });

  it("rejects an empty source set", () => {
    expect(validateEvidenceSources(["", "  "]).error).toMatch(/required/i);
  });

  it("rejects an oversized URL", () => {
    expect(validateEvidenceSources([`https://example.com/${"x".repeat(2048)}`]).error).toMatch(/2048/);
  });

  it("returns canonical sorted sources", () => {
    expect(validateEvidenceSources([" https://b.example ", "https://a.example"]).error).toBeNull();
    expect(validateEvidenceSources([" https://b.example ", "https://a.example"]).canonical).toEqual(["https://a.example", "https://b.example"]);
  });

  it("mirrors the non-empty and maximum policy bounds", () => {
    expect(validateRecallPolicy("  ")).toMatch(/required/i);
    expect(validateRecallPolicy("x".repeat(4001))).toMatch(/4000/);
    expect(validateRecallPolicy("valid policy")).toBeNull();
  });
});
