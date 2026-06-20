export type GuiActionSource = 'agent' | 'loop' | 'gateway' | 'cli' | 'web' | 'test'

export type GuiActionIdentity = {
  workspaceId: string
  guiActionId: string
  runId?: string
  loopId?: string
  goalId?: string
  taskId?: string
  attemptId?: string
  source: GuiActionSource
  createdAtMs: number
}

export function createGuiActionIdentity(input: {
  workspaceId: string
  guiActionId?: string
  runId?: string
  loopId?: string
  goalId?: string
  taskId?: string
  attemptId?: string
  source?: GuiActionSource
  createdAtMs?: number
}): GuiActionIdentity {
  const createdAtMs = input.createdAtMs ?? Date.now()
  return {
    workspaceId: input.workspaceId,
    guiActionId: input.guiActionId ?? createGuiActionId(createdAtMs),
    runId: input.runId,
    loopId: input.loopId,
    goalId: input.goalId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    source: input.source ?? 'agent',
    createdAtMs,
  }
}

export function createGuiActionId(nowMs = Date.now()): string {
  return createScopedId('gui_action', nowMs)
}

export function createGuiObservationId(nowMs = Date.now()): string {
  return createScopedId('gui_obs', nowMs)
}

export function createGuiLeaseId(nowMs = Date.now()): string {
  return createScopedId('gui_lease', nowMs)
}

function createScopedId(prefix: string, nowMs: number): string {
  const time = Math.max(0, Math.trunc(nowMs)).toString(36)
  const entropy = Math.random().toString(36).slice(2, 12)
  return `${prefix}_${time}_${entropy}`
}
