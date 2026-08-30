import { normalizeSources } from "./format";

export interface RegisterFormValues {
  manufacturer: string;
  productName: string;
  productModel: string;
  sku: string;
  lotNumber: string;
  batchCode: string;
  manufactureDate: string;
  productIdentifier: string;
  recallPolicy: string;
  evidenceSources: string[];
}

export function registerArgs(values: RegisterFormValues): unknown[] {
  return [
    values.manufacturer,
    values.productName,
    values.productModel,
    values.sku,
    values.lotNumber,
    values.batchCode,
    values.manufactureDate,
    values.productIdentifier,
    values.recallPolicy,
    normalizeSources(values.evidenceSources),
  ];
}

export function assessmentArgs(
  batchId: number,
  title: string,
  notes: string,
  frozenSources: readonly string[],
): unknown[] {
  return [BigInt(batchId), title, notes, normalizeSources(frozenSources)];
}

export function policyArgs(batchId: number, policy: string): unknown[] {
  return [BigInt(batchId), policy];
}

export function sourcesArgs(batchId: number, sources: readonly string[]): unknown[] {
  return [BigInt(batchId), normalizeSources(sources)];
}

export function activeArgs(batchId: number, active: boolean): unknown[] {
  return [BigInt(batchId), active];
}
