import type { LoopStateJournal } from './LoopStateJournal.js'
import { type LoopSpecV3, isSupportedAutomationTrigger } from './LoopSpecV3.js'

export type AutomationTaskSideEffect = 'none' | 'read' | 'workspace_write' | 'external_write' | 'gui_write' | 'gateway_write'

export type AutomationTaskPlan = {
  taskId: string
  title: string
  sideEffect: AutomationTaskSideEffect
  dueAtMs?: number
}

export type AutomationTickStatus = 'selected' | 'skipped'

export type AutomationTickResult = {
  eventType: 'loop_engineering_automation_tick'
  loopId: string
  goalId: string
  trigger: LoopSpecV3['automationTrigger']
  status: AutomationTickStatus
  selectedTaskId?: string
  selectedTask?: AutomationTaskPlan
  skippedUnsafeTaskIds: string[]
  reason: string
  createdAtMs: number
}

export type AutomationSchedulerOptions = {
  journal?: Pick<LoopStateJournal, 'recordAutomationTick'>
}

export class AutomationScheduler {
  private readonly pausedLoopIds = new Set<string>()
  private readonly lastTickAtMs = new Map<string, number>()

  constructor(private readonly options: AutomationSchedulerOptions = {}) {}

  pause(loopId: string): void {
    this.pausedLoopIds.add(loopId)
  }

  resume(loopId: string): void {
    this.pausedLoopIds.delete(loopId)
  }

  isPaused(loopId: string): boolean {
    return this.pausedLoopIds.has(loopId)
  }

  async tick(input: { spec: LoopSpecV3; tasks?: readonly AutomationTaskPlan[]; manual?: boolean; nowMs?: number }): Promise<AutomationTickResult> {
    const nowMs = input.nowMs ?? Date.now()
    const tasks = input.tasks ?? []
    let result: AutomationTickResult

    if (this.pausedLoopIds.has(input.spec.loopId)) {
      result = this.skipped(input.spec, nowMs, 'loop_paused', tasks)
      return this.writeTick(result)
    }

    if (!isSupportedAutomationTrigger(input.spec.automationTrigger)) {
      result = this.skipped(input.spec, nowMs, `unsupported_automation_trigger:${input.spec.automationTrigger}`, tasks)
      return this.writeTick(result)
    }

    if (!this.isDue(input.spec, input.manual === true, nowMs)) {
      result = this.skipped(input.spec, nowMs, 'trigger_not_due', tasks)
      return this.writeTick(result)
    }

    const skippedUnsafeTaskIds = tasks.filter(task => !isSafeTask(task)).map(task => task.taskId)
    const selectedTask = tasks.find(task => isSafeTask(task) && (task.dueAtMs === undefined || task.dueAtMs <= nowMs))
    if (!selectedTask) {
      result = {
        eventType: 'loop_engineering_automation_tick',
        loopId: input.spec.loopId,
        goalId: input.spec.goalId,
        trigger: input.spec.automationTrigger,
        status: 'skipped',
        skippedUnsafeTaskIds,
        reason: skippedUnsafeTaskIds.length > 0 ? 'no_safe_due_task' : 'no_due_task',
        createdAtMs: nowMs,
      }
      return this.writeTick(result)
    }

    this.lastTickAtMs.set(input.spec.loopId, nowMs)
    result = {
      eventType: 'loop_engineering_automation_tick',
      loopId: input.spec.loopId,
      goalId: input.spec.goalId,
      trigger: input.spec.automationTrigger,
      status: 'selected',
      selectedTaskId: selectedTask.taskId,
      selectedTask,
      skippedUnsafeTaskIds,
      reason: 'selected_one_safe_task',
      createdAtMs: nowMs,
    }
    return this.writeTick(result)
  }

  private isDue(spec: LoopSpecV3, manual: boolean, nowMs: number): boolean {
    if (spec.automationTrigger === 'manual') return manual
    const lastTick = this.lastTickAtMs.get(spec.loopId)
    if (lastTick === undefined) return true
    if (spec.automationTrigger === 'interval') return nowMs - lastTick >= (spec.automationIntervalMs ?? 60_000)
    if (spec.automationTrigger === 'heartbeat') return nowMs - lastTick >= (spec.heartbeatIntervalMs ?? 30_000)
    return false
  }

  private skipped(spec: LoopSpecV3, nowMs: number, reason: string, tasks: readonly AutomationTaskPlan[]): AutomationTickResult {
    return {
      eventType: 'loop_engineering_automation_tick',
      loopId: spec.loopId,
      goalId: spec.goalId,
      trigger: spec.automationTrigger,
      status: 'skipped',
      skippedUnsafeTaskIds: tasks.filter(task => !isSafeTask(task)).map(task => task.taskId),
      reason,
      createdAtMs: nowMs,
    }
  }

  private async writeTick(result: AutomationTickResult): Promise<AutomationTickResult> {
    await this.options.journal?.recordAutomationTick(result)
    return result
  }
}

export function isSafeTask(task: AutomationTaskPlan): boolean {
  return task.sideEffect === 'none' || task.sideEffect === 'read'
}