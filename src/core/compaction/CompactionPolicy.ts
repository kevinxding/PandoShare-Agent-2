export type CompactionPolicy = { maxSummaryChars: number; requireToolPairing: boolean }
export function defaultCompactionPolicy(): CompactionPolicy { return { maxSummaryChars: 4000, requireToolPairing: true } }
