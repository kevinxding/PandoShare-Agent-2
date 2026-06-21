export const TOOL_EVENT_TYPES = {
  requested: 'tool_call_requested',
  approvalRequired: 'tool_call_approval_required',
  started: 'tool_call_started',
  progress: 'tool_call_progress',
  completed: 'tool_call_completed',
  failed: 'tool_call_failed',
  timeout: 'tool_call_timeout',
  resultStored: 'tool_result_stored',
} as const
export type ToolEventType = typeof TOOL_EVENT_TYPES[keyof typeof TOOL_EVENT_TYPES]
export function isToolEventType(value: string): value is ToolEventType { return Object.values(TOOL_EVENT_TYPES).includes(value as ToolEventType) }
