import type { Batch, RegistryRow } from "./types";

export type BatchDisplayStatus =
  | "RECALL ACTIVE"
  | "NOT AFFECTED"
  | "WATCH"
  | "UNDETERMINED"
  | "UNKNOWN / READ UNAVAILABLE";

export function shortHash(value: string, start = 8, end = 6): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US")
    : "UNKNOWN";
}

export function formatDate(value: string): string {
  return value || "NOT PROVIDED";
}

export function formatOptionalText(value: string): string {
  return value || "NOT PROVIDED";
}

export function hostnameFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "INVALID HOST";
  }
}

export function deriveBatchStatus(batch: Batch): BatchDisplayStatus {
  if (batch.recallActive) return "RECALL ACTIVE";
  switch (batch.latestVerdict) {
    case "NOT_AFFECTED":
      return "NOT AFFECTED";
    case "WATCH":
      return "WATCH";
    case "UNDETERMINED":
      return "UNDETERMINED";
    case "AFFECTED":
      return "WATCH";
    default:
      return "UNKNOWN / READ UNAVAILABLE";
  }
}

export function statusTone(status: BatchDisplayStatus):
  | "critical"
  | "safe"
  | "watch"
  | "unknown" {
  if (status === "RECALL ACTIVE") return "critical";
  if (status === "NOT AFFECTED") return "safe";
  if (status === "WATCH") return "watch";
  return "unknown";
}

export function normalizeSources(values: readonly string[]): string[] {
  return [...values].map((value) => value.trim()).filter(Boolean).sort();
}

export function sourcesMatchExactly(
  frozen: readonly string[],
  submitted: readonly string[],
): boolean {
  const left = normalizeSources(frozen);
  const right = normalizeSources(submitted);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function deriveActiveRecallCount(
  rows: readonly RegistryRow[],
  capped: boolean,
): number | null {
  if (capped || rows.some((row) => row.error)) return null;
  return rows.filter((row) => row.batch?.recallActive === true).length;
}

export function errorMessage(
  error: unknown,
  fallback = "The requested state is unavailable.",
): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
