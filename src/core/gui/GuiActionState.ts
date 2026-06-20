export type GuiActionState =
  | 'requested'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed'
  | 'verified'
  | 'stuck'
  | 'recovery_required'

export const GUI_TERMINAL_STATES = new Set<GuiActionState>([
  'rejected',
  'completed',
  'failed',
  'verified',
  'stuck',
  'recovery_required',
])

export function isTerminalGuiActionState(state: GuiActionState): boolean {
  return GUI_TERMINAL_STATES.has(state)
}
