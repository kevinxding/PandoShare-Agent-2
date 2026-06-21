export function emptyApprovalSummary(): Record<string, unknown> {
  return { pendingCount: 0, pending: [], policy: 'dangerous GUI, gateway outbound, and elevated actions require approval in production wiring' }
}
