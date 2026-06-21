export const COMPACTION_EVENT_TYPES = {
  requested: 'compaction_requested',
  started: 'compaction_started',
  completed: 'compaction_completed',
  failed: 'compaction_failed',
} as const
export type CompactionEventType = typeof COMPACTION_EVENT_TYPES[keyof typeof COMPACTION_EVENT_TYPES]
