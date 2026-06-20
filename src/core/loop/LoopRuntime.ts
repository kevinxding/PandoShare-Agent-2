import { DurableRuntime } from '../durable/index.js'
import { AgentKernel } from '../agent/index.js'
import { AttemptRunner } from './AttemptRunner.js'
import { GoalPlanner } from './GoalPlanner.js'
import { HumanGate } from './HumanGate.js'
import { LOOP_EVENT_TYPES } from './LoopEventTypes.js'
import { createLoopIdentity, createPlanId, type LoopIdentity, type LoopIdentitySource } from './LoopIdentity.js'
import { projectLoopState, type LoopState, type TaskProjection } from './LoopProjector.js'
import { LoopRecovery, type LoopRecoveryResult } from './LoopRecovery.js'
import { selectNextTask, type ScheduleDecision } from './LoopScheduler.js'
import { LoopStateStore } from './LoopStateStore.js'
import { LoopVerifier } from './LoopVerifier.js'
import type { Goal, LoopRuntimeResult, Plan, Task, VerificationResult } from './LoopTypes.js'

export type CoreLoopRuntimeOptions = {
  workspaceRoot: string
  workspaceId?: string
  agentKernel: Pick<AgentKernel, 'submitRun' | 'recordCoreEvent'>
  maxAttempts?: number
}

export type CreateLoopInput = {
  objective: string
  successCriteria?: readonly string[]
  constraints?: readonly string[]
  task?: Partial<Task>
  loopId?: string
  goalId?: string
  rootThreadId?: string
  createdByCommandId?: string
  source?: LoopIdentitySource
}

export type CreateLoopResult = {
  identity: LoopIdentity
  goal: Goal
  plan: Plan
  state: LoopState
}

export type RunNextResult =
  | (LoopRuntimeResult & { loopId: string; state: LoopState; decision: ScheduleDecision })
  | { loopId: string; state: LoopState; decision: ScheduleDecision; gateId?: string }

export class LoopRuntime {
  private readonly workspaceId: string
  private readonly durable: DurableRuntime
  private readonly planner = new GoalPlanner()
  private readonly verifier: LoopVerifier
  private readonly humanGate: HumanGate
  private readonly attempts: AttemptRunner
  private readonly stateStore: LoopStateStore
  private readonly recovery: LoopRecovery

  constructor(private readonly options: CoreLoopRuntimeOptions) {
    this.workspaceId = options.workspaceId ?? 'default'
    this.durable = new DurableRuntime({ workspaceRoot: options.workspaceRoot, workspaceId: this.workspaceId })
    this.verifier = new LoopVerifier(this.durable)
    this.humanGate = new HumanGate(this.durable)
    this.attempts = new AttemptRunner(options.agentKernel)
    this.stateStore = new LoopStateStore(this.durable)
    this.recovery = new LoopRecovery(this.durable)
  }

  async createLoop(input: CreateLoopInput): Promise<CreateLoopResult> {
    const identity = createLoopIdentity({
      workspaceId: this.workspaceId,
      loopId: input.loopId,
      goalId: input.goalId,
      rootThreadId: input.rootThreadId,
      createdByCommandId: input.createdByCommandId,
      source: input.source ?? 'daemon',
    })
    const goal = this.planner.createGoal({
      goalId: identity.goalId,
      objective: input.objective,
      successCriteria: input.successCriteria,
      constraints: input.constraints,
    })
    const basePlan = this.planner.createPlan(goal)
    const task: Task = {
      ...basePlan.tasks[0]!,
      ...input.task,
      goalId: goal.goalId,
    }
    const plan: Plan = {
      ...basePlan,
      planId: createPlanId(identity.createdAtMs),
      tasks: [task],
    }
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.goalCreated,
      workspaceId: this.workspaceId,
      loopId: identity.loopId,
      goalId: identity.goalId,
      createdAtMs: identity.createdAtMs,
      payload: { identity, objective: goal.objective, successCriteria: goal.successCriteria, constraints: goal.constraints },
    })
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.planCreated,
      workspaceId: this.workspaceId,
      loopId: identity.loopId,
      goalId: identity.goalId,
      payload: { loopId: identity.loopId, planId: plan.planId, taskCount: plan.tasks.length },
    })
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.taskCreated,
      workspaceId: this.workspaceId,
      loopId: identity.loopId,
      goalId: identity.goalId,
      taskId: task.taskId,
      payload: { taskId: task.taskId, title: task.title, task },
    })
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.taskQueued,
      workspaceId: this.workspaceId,
      loopId: identity.loopId,
      goalId: identity.goalId,
      taskId: task.taskId,
      payload: { taskId: task.taskId, title: task.title, task },
    })
    return { identity, goal, plan, state: await this.status(identity.loopId) }
  }

  async runNext(loopId: string): Promise<RunNextResult> {
    const state = await this.status(loopId)
    const decision = selectNextTask(state, { maxAttempts: this.options.maxAttempts })
    if (decision.type !== 'run_task') {
      if (decision.type === 'completed') await this.ensureLoopCompletedEvent(state, decision.reason)
      if (decision.type === 'blocked') await this.ensureLoopBlockedEvent(state, decision.reason)
      return { loopId, state: await this.status(loopId), decision }
    }

    const task = taskFromProjection(decision.task, state.goalId)
    if (task.requiresApproval) {
      const gate = await this.humanGate.createRequest({
        workspaceId: this.workspaceId,
        loopId,
        goalId: state.goalId,
        task,
        reason: 'Task requires approval.',
        risk: 'approval_required',
      })
      return { loopId, state: await this.status(loopId), decision: { type: 'wait_human', gateId: gate.gateId, reason: 'task requires approval' }, gateId: gate.gateId }
    }

    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.taskStarted,
      workspaceId: this.workspaceId,
      loopId,
      goalId: state.goalId,
      taskId: task.taskId,
      payload: { taskId: task.taskId, title: task.title, task },
    })

    let attempt = await this.attempts.run({ workspaceId: this.workspaceId, loopId, goalId: state.goalId, task })
    const verification = await this.verifier.verify(task.verifier, {
      durable: this.durable,
      workspaceId: this.workspaceId,
      loopId,
      goalId: state.goalId,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      runId: attempt.runId,
    })
    const checkpoint = await this.durable.createCheckpoint({
      workspaceId: this.workspaceId,
      loopId,
      goalId: state.goalId,
      runId: attempt.runId,
      status: verification.ok ? 'safe_to_replay' : 'partial_replay',
      summary: verification.ok ? `loop task completed: ${task.title}` : `loop task failed verification: ${task.title}`,
      payload: {
        loopId,
        taskId: task.taskId,
        attemptId: attempt.attemptId,
        verification,
      },
    })
    attempt = { ...attempt, checkpointId: checkpoint.checkpointId }
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.checkpointCreated,
      workspaceId: this.workspaceId,
      loopId,
      goalId: state.goalId,
      runId: attempt.runId,
      taskId: task.taskId,
      payload: { checkpointId: checkpoint.checkpointId, attemptId: attempt.attemptId, status: checkpoint.status },
    })
    if (verification.ok) {
      await this.durable.appendEvent({
        eventType: LOOP_EVENT_TYPES.taskCompleted,
        workspaceId: this.workspaceId,
        loopId,
        goalId: state.goalId,
        runId: attempt.runId,
        taskId: task.taskId,
        payload: { taskId: task.taskId, attemptId: attempt.attemptId, checkpointId: checkpoint.checkpointId, verification },
      })
      await this.ensureLoopCompletedEvent(await this.status(loopId), 'all tasks completed')
    } else {
      await this.durable.appendEvent({
        eventType: LOOP_EVENT_TYPES.taskFailed,
        workspaceId: this.workspaceId,
        loopId,
        goalId: state.goalId,
        runId: attempt.runId,
        taskId: task.taskId,
        payload: { taskId: task.taskId, attemptId: attempt.attemptId, checkpointId: checkpoint.checkpointId, verification, reason: verification.reason ?? verification.message },
      })
    }
    const nextState = await this.status(loopId)
    return {
      loopId,
      state: nextState,
      decision,
      goal: goalFromState(nextState),
      plan: planFromState(nextState),
      task: { ...task, status: verification.ok ? 'completed' : 'failed' },
      attempt,
      verification,
    }
  }

  async resumeLoop(loopId: string): Promise<LoopRecoveryResult> {
    return this.recoverLoop(loopId)
  }

  async status(loopId: string): Promise<LoopState> {
    return (await this.stateStore.read(loopId)).state
  }

  async recoverLoop(loopId: string): Promise<LoopRecoveryResult> {
    return this.recovery.recoverLoop(loopId)
  }


  async pauseLoop(loopId: string, reason = 'loop paused by command'): Promise<LoopState> {
    const state = await this.status(loopId)
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.blocked,
      workspaceId: state.workspaceId,
      loopId: state.loopId,
      goalId: state.goalId,
      runId: state.lastRunId,
      payload: { reason, command: 'loop.pause' },
    })
    return this.status(loopId)
  }

  async stopLoop(loopId: string, reason = 'loop stopped by command'): Promise<LoopState> {
    const state = await this.status(loopId)
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.blocked,
      workspaceId: state.workspaceId,
      loopId: state.loopId,
      goalId: state.goalId,
      runId: state.lastRunId,
      payload: { reason, command: 'loop.stop', activeRunId: state.lastRunId },
    })
    return this.status(loopId)
  }

  async approveHumanGate(input: { loopId: string; gateId?: string; resolvedBy?: string; reason?: string }): Promise<LoopState> {
    return this.resolveHumanGate({ ...input, approved: true })
  }

  async rejectHumanGate(input: { loopId: string; gateId?: string; resolvedBy?: string; reason?: string }): Promise<LoopState> {
    return this.resolveHumanGate({ ...input, approved: false })
  }

  private async resolveHumanGate(input: { loopId: string; gateId?: string; approved: boolean; resolvedBy?: string; reason?: string }): Promise<LoopState> {
    const state = await this.status(input.loopId)
    const gateId = input.gateId ?? state.pendingHumanGateId
    if (!gateId) throw new Error(`Loop has no pending human gate: ${input.loopId}`)
    const gate = state.humanGates.find(item => item.gateId === gateId)
    await this.humanGate.resolveRequest({
      workspaceId: state.workspaceId,
      loopId: state.loopId,
      goalId: state.goalId,
      taskId: gate?.taskId,
      gateId,
      approved: input.approved,
      resolvedBy: input.resolvedBy,
      reason: input.reason,
    })
    return this.status(input.loopId)
  }

  async runGoal(input: {
    objective: string
    successCriteria?: readonly string[]
    constraints?: readonly string[]
    task?: Partial<Task>
  }): Promise<LoopRuntimeResult> {
    const created = await this.createLoop(input)
    const result = await this.runNext(created.identity.loopId)
    if (!('attempt' in result)) throw new Error(`LoopRuntime.runGoal did not execute an attempt: ${result.decision.type}`)
    return {
      goal: result.goal,
      plan: result.plan,
      task: result.task,
      attempt: result.attempt,
      verification: result.verification,
    }
  }

  private async ensureLoopCompletedEvent(state: LoopState, reason: string): Promise<void> {
    const existing = await this.durable.readEvents({ loopId: state.loopId })
    if (existing.some(event => event.eventType === LOOP_EVENT_TYPES.completed)) return
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.completed,
      workspaceId: state.workspaceId,
      loopId: state.loopId,
      goalId: state.goalId,
      payload: { reason, taskCount: state.tasks.length },
    })
  }

  private async ensureLoopBlockedEvent(state: LoopState, reason: string): Promise<void> {
    const existing = await this.durable.readEvents({ loopId: state.loopId })
    if (existing.some(event => event.eventType === LOOP_EVENT_TYPES.blocked)) return
    await this.durable.appendEvent({
      eventType: LOOP_EVENT_TYPES.blocked,
      workspaceId: state.workspaceId,
      loopId: state.loopId,
      goalId: state.goalId,
      runId: state.lastRunId,
      payload: { reason, failureCount: state.failureCount },
    })
  }
}

function taskFromProjection(task: TaskProjection, goalId: string): Task {
  return {
    taskId: task.taskId,
    goalId: task.goalId ?? goalId,
    title: task.title,
    status: 'running',
    executionMode: task.executionMode,
    verifier: task.verifier ?? { type: 'custom', name: 'manual_review' },
    requiresApproval: task.requiresApproval,
  }
}

function goalFromState(state: LoopState): Goal {
  return {
    goalId: state.goalId,
    objective: 'Recovered from loop projection.',
    successCriteria: [],
    constraints: [],
    status: state.status === 'completed' ? 'completed' : state.status === 'blocked' ? 'blocked' : state.status === 'failed' ? 'failed' : 'running',
    createdAtMs: state.updatedAtMs,
  }
}

function planFromState(state: LoopState): Plan {
  return {
    planId: `plan_projection_${state.loopId}`,
    goalId: state.goalId,
    tasks: state.tasks.map(task => ({
      taskId: task.taskId,
      goalId: task.goalId ?? state.goalId,
      title: task.title,
      status: task.status === 'created' ? 'queued' : task.status,
      executionMode: task.executionMode,
      verifier: task.verifier ?? { type: 'custom', name: 'manual_review' },
      requiresApproval: task.requiresApproval,
    })),
    createdAtMs: state.updatedAtMs,
  }
}
