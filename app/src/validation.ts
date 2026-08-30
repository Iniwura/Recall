import { LIMITS } from "./constants";

export interface SourceValidationResult {
  canonical: string[];
  error: string | null;
}

export function validateEvidenceSources(values: readonly unknown[]): SourceValidationResult {
  if (!Array.isArray(values)) return { canonical: [], error: "Evidence sources must be a list." };
  if (values.some((value) => typeof value !== "string")) {
    return { canonical: [], error: "Every evidence source must be a string." };
  }

  const canonical = values
    .map((value) => (value as string).trim())
    .filter(Boolean)
    .sort();
  if (canonical.length < 1) return { canonical, error: "At least one evidence source is required." };
  if (canonical.length > LIMITS.sourceCount) {
    return { canonical, error: `No more than ${LIMITS.sourceCount} evidence sources are permitted.` };
  }
  for (const source of canonical) {
    if (source.length > LIMITS.sourceUrl) {
      return { canonical, error: `Evidence source URLs must be ${LIMITS.sourceUrl} characters or fewer.` };
    }
    if (/\s/.test(source)) return { canonical, error: "Evidence source URLs cannot contain whitespace." };
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      return { canonical, error: "Every evidence source must be a valid URL." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { canonical, error: "Every evidence source must use HTTP(S)." };
    }
    if (!parsed.hostname) return { canonical, error: "Every evidence source must include a host." };
  }
  if (new Set(canonical).size !== canonical.length) {
    return { canonical, error: "Evidence source URLs cannot contain duplicates." };
  }
  return { canonical, error: null };
}

export function validateRecallPolicy(value: string): string | null {
  if (!value.trim()) return "Recall policy is required.";
  if (value.length > LIMITS.policy) return `Recall policy must be ${LIMITS.policy} characters or fewer.`;
  return null;
}
