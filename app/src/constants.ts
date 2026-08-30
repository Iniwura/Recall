export const CONTRACT_ADDRESS =
  "0x876Eb31536FfB3eF448dbdeB905118E70761981C" as const;
export const NETWORK_NAME = "Bradbury" as const;
export const NETWORK_CHAIN_ID = 4221 as const;
export const NETWORK_CHAIN_ID_HEX = "0x107d" as const;
export const RPC_URL = "https://rpc-bradbury.genlayer.com" as const;
export const EXPLORER_URL = "https://explorer-bradbury.genlayer.com/" as const;

export const LIMITS = {
  identity: 256,
  policy: 4000,
  title: 256,
  notes: 1000,
  sourceCount: 4,
  sourceUrl: 2048,
  registryScan: 50,
  assessmentScan: 100,
  confirmationScan: 50,
} as const;

export const VERDICTS = [
  "AFFECTED",
  "NOT_AFFECTED",
  "WATCH",
  "UNDETERMINED",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const BINDINGS = ["BOUND", "PARTIAL", "UNBOUND"] as const;
export type Binding = (typeof BINDINGS)[number];
