import {
  LocalGoalStore,
  type GoalCreateInput,
  type GoalExportData,
  type GoalStatus,
  type GoalSummary,
} from '../goalStore/index.js'

export type GoalTerminalUpdateSource = 'user' | 'runtime' | 'tool'

export type GoalServiceUpdateInput = {
  status: GoalStatus
  reason?: string
  source?: GoalTerminalUpdateSource
}

export class GoalService {
  constructor(readonly store: LocalGoalStore) {}

  createGoal(input: GoalCreateInput): Promise<GoalSummary> {
    return this.store.createGoal({
      ...input,
      objective: requireNonEmpty(input.objective, 'Goal objective must not be empty'),
      requirements: input.requirements?.map(item => item.trim()).filter(Boolean),
    })
  }

  listGoals(input: { limit?: number; status?: GoalStatus } = {}): Promise<GoalSummary[]> {
    return this.store.listGoals(input)
  }

  activeGoal(): Promise<GoalSummary | undefined> {
    return this.store.activeGoal()
  }

  readGoal(goalId: string): Promise<GoalExportData> {
    return this.store.readExport(goalId)
  }

  readSummary(goalId: string): Promise<GoalSummary> {
    return this.store.readSummary(goalId)
  }

  exportGoal(goalId: string, format: 'json' | 'md' = 'md'): Promise<string> {
    return this.store.exportGoal(goalId, format)
  }

  resumeGoal(goalId: string, reason = 'Goal resumed.'): Promise<GoalSummary> {
    return this.store.updateStatus(goalId, 'active', reason)
  }

  pauseGoal(goalId: string, reason = 'Goal paused.'): Promise<GoalSummary> {
    return this.store.updateStatus(goalId, 'paused', reason)
  }

  async updateGoal(goalId: string, input: GoalServiceUpdateInput): Promise<GoalSummary> {
    if (input.status === 'completed') return this.completeGoal(goalId)
    if (input.status === 'blocked') return this.blockGoal(goalId, input.reason, input.source ?? 'tool')
    if (input.source === 'tool') {
      throw new Error('Model tools can only request conservative terminal goal updates: completed or blocked.')
    }
    return this.store.updateStatus(goalId, input.status, input.reason)
  }

  completeGoal(goalId: string): Promise<GoalSummary> {
    return this.store.completeGoal(goalId)
  }

  async blockGoal(goalId: string, reason: string | undefined, source: GoalTerminalUpdateSource = 'user'): Promise<GoalSummary> {
    const message = requireNonEmpty(reason ?? '', 'Blocking a goal requires a concrete reason.')
    if (source === 'tool' || source === 'runtime') {
      const data = await this.store.readExport(goalId)
      const repeated = data.progress
        .slice(-5)
        .filter(progress => progress.message.includes(message))
        .length
      if (repeated < 2) {
        await this.store.appendProgress(goalId, `Block attempt recorded but not accepted yet: ${message}`)
        throw new Error('Goal cannot be blocked yet: the same blocker has not repeated across multiple attempts.')
      }
    }
    return this.store.updateStatus(goalId, 'blocked', message)
  }
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}
