import { GoalService } from '../goalService/index.js'
import { LocalGoalStore, type GoalExportData, type GoalSummary } from '../goalStore/index.js'

export type GoalRuntimeStepResult = {
  message: string
  tokenUsage?: number
}

export type GoalRuntimeOptions = {
  sessionId: string
  idle?: boolean
  maxRuntimeMs?: number
  maxRuns?: number
  maxTokens?: number
  onContinue?: (goal: GoalExportData) => Promise<GoalRuntimeStepResult> | GoalRuntimeStepResult
}

export type GoalRuntimeOutput = {
  ok: boolean
  goal?: GoalSummary
  status: 'no_active_goal' | 'continued' | 'usage_limited' | 'budget_limited' | 'failed'
  message: string
}

export class GoalRuntime {
  readonly service: GoalService

  constructor(readonly store: LocalGoalStore) {
    this.service = new GoalService(store)
  }

  async resumeActiveGoal(options: GoalRuntimeOptions): Promise<GoalRuntimeOutput> {
    const active = await this.service.activeGoal()
    if (!active) {
      return {
        ok: true,
        status: 'no_active_goal',
        message: 'No active goal found.',
      }
    }
    return this.continueGoal(active.metadata.goalId, options)
  }

  async continueGoal(goalId: string, options: GoalRuntimeOptions): Promise<GoalRuntimeOutput> {
    const startedAtMs = Date.now()
    const data = await this.service.readGoal(goalId)
    if (options.maxRuns !== undefined && (data.metadata.usageRunCount ?? 0) >= options.maxRuns) {
      const goal = await this.service.updateGoal(goalId, {
        status: 'usage_limited',
        reason: `Goal reached maxRuns=${options.maxRuns}.`,
        source: 'runtime',
      })
      return {
        ok: true,
        goal,
        status: 'usage_limited',
        message: `Goal reached maxRuns=${options.maxRuns}.`,
      }
    }
    if (options.maxTokens !== undefined && (data.metadata.usageTokens ?? 0) >= options.maxTokens) {
      const goal = await this.service.updateGoal(goalId, {
        status: 'budget_limited',
        reason: `Goal reached maxTokens=${options.maxTokens}.`,
        source: 'runtime',
      })
      return {
        ok: true,
        goal,
        status: 'budget_limited',
        message: `Goal reached maxTokens=${options.maxTokens}.`,
      }
    }

    const runId = `goal_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await this.store.appendRun(goalId, {
      runId,
      kind: 'manual',
      status: 'started',
      startedAtMs,
      summary: options.idle ? 'Goal runtime idle continuation started.' : 'Goal runtime resumed.',
    })

    try {
      const result = options.onContinue
        ? await options.onContinue(data)
        : { message: options.idle ? 'Goal runtime checked active goal while idle.' : 'Goal runtime resumed active goal.' }
      const completedAtMs = Date.now()
      const durationMs = completedAtMs - startedAtMs
      if (options.maxRuntimeMs !== undefined && durationMs > options.maxRuntimeMs) {
        const goal = await this.service.updateGoal(goalId, {
          status: 'usage_limited',
          reason: `Goal runtime exceeded maxRuntimeMs=${options.maxRuntimeMs}.`,
          source: 'runtime',
        })
        return {
          ok: true,
          goal,
          status: 'usage_limited',
          message: `Goal runtime exceeded maxRuntimeMs=${options.maxRuntimeMs}.`,
        }
      }
      await this.store.appendRun(goalId, {
        runId,
        kind: 'manual',
        status: 'completed',
        startedAtMs,
        completedAtMs,
        durationMs,
        tokenUsage: result.tokenUsage,
        summary: result.message,
      })
      await this.store.appendProgress(goalId, result.message)
      await this.store.appendCheckpoint(goalId, result.message)
      return {
        ok: true,
        goal: await this.service.readSummary(goalId),
        status: 'continued',
        message: result.message,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const completedAtMs = Date.now()
      await this.store.appendRun(goalId, {
        runId,
        kind: 'manual',
        status: 'failed',
        startedAtMs,
        completedAtMs,
        durationMs: completedAtMs - startedAtMs,
        summary: message,
      })
      await this.store.appendProgress(goalId, `Goal runtime stopped after error: ${message}`)
      await this.store.appendCheckpoint(goalId, `Goal runtime stopped after error: ${message}`)
      return {
        ok: false,
        goal: await this.service.readSummary(goalId),
        status: 'failed',
        message,
      }
    }
  }
}
