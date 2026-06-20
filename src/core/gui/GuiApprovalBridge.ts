import type { DurableRuntime } from '../durable/index.js'
import { GUI_EVENT_TYPES } from './GuiEventTypes.js'
import type { GuiActionIdentity } from './GuiIdentity.js'
import type { GuiApprovalPolicy, GuiApprovalRecord, GuiActionRisk, GuiRuntimeAction } from './GuiTypes.js'

export class GuiApprovalBridge {
  constructor(private readonly durable: DurableRuntime) {}

  async apply(input: {
    identity: GuiActionIdentity
    action: GuiRuntimeAction
    risk: GuiActionRisk
    policy: GuiApprovalPolicy
    required: boolean
  }): Promise<GuiApprovalRecord> {
    if (!input.required) {
      const approval: GuiApprovalRecord = {
        required: false,
        status: 'not_required',
        policy: input.policy,
        reason: input.risk.reason,
      }
      if (input.policy === 'trusted') {
        approval.status = 'approved'
        approval.approvedByPolicy = true
        approval.decidedAtMs = Date.now()
        await this.writeApproved(input.identity, input.action, input.risk, approval)
      }
      return approval
    }
    await this.durable.appendEvent({
      eventType: GUI_EVENT_TYPES.actionApprovalRequired,
      workspaceId: input.identity.workspaceId,
      runId: input.identity.runId,
      loopId: input.identity.loopId,
      goalId: input.identity.goalId,
      taskId: input.identity.taskId,
      payload: {
        ...identityPayload(input.identity),
        action: input.action.action,
        risk: input.risk,
        policy: input.policy,
      },
    })
    if (input.policy === 'never') {
      const approval: GuiApprovalRecord = {
        required: true,
        status: 'rejected',
        policy: input.policy,
        reason: 'approvalPolicy=never rejects GUI write action',
        decidedAtMs: Date.now(),
      }
      await this.writeRejected(input.identity, input.action, input.risk, approval)
      return approval
    }
    return {
      required: true,
      status: 'waiting',
      policy: input.policy,
      reason: input.risk.reason,
    }
  }

  approveGuiAction(identity: GuiActionIdentity, action: GuiRuntimeAction, risk: GuiActionRisk, reason?: string): Promise<GuiApprovalRecord> {
    const approval: GuiApprovalRecord = {
      required: true,
      status: 'approved',
      policy: action.approvalPolicy ?? 'ask',
      reason,
      decidedAtMs: Date.now(),
    }
    return this.writeApproved(identity, action, risk, approval)
  }

  rejectGuiAction(identity: GuiActionIdentity, action: GuiRuntimeAction, risk: GuiActionRisk, reason?: string): Promise<GuiApprovalRecord> {
    const approval: GuiApprovalRecord = {
      required: true,
      status: 'rejected',
      policy: action.approvalPolicy ?? 'ask',
      reason,
      decidedAtMs: Date.now(),
    }
    return this.writeRejected(identity, action, risk, approval)
  }

  private async writeApproved(identity: GuiActionIdentity, action: GuiRuntimeAction, risk: GuiActionRisk, approval: GuiApprovalRecord): Promise<GuiApprovalRecord> {
    await this.durable.appendEvent({
      eventType: GUI_EVENT_TYPES.actionApproved,
      workspaceId: identity.workspaceId,
      runId: identity.runId,
      loopId: identity.loopId,
      goalId: identity.goalId,
      taskId: identity.taskId,
      payload: { ...identityPayload(identity), action: action.action, risk, approval },
    })
    return approval
  }

  private async writeRejected(identity: GuiActionIdentity, action: GuiRuntimeAction, risk: GuiActionRisk, approval: GuiApprovalRecord): Promise<GuiApprovalRecord> {
    await this.durable.appendEvent({
      eventType: GUI_EVENT_TYPES.actionRejected,
      workspaceId: identity.workspaceId,
      runId: identity.runId,
      loopId: identity.loopId,
      goalId: identity.goalId,
      taskId: identity.taskId,
      payload: { ...identityPayload(identity), action: action.action, risk, approval },
    })
    return approval
  }
}

function identityPayload(identity: GuiActionIdentity): Record<string, unknown> {
  return {
    guiActionId: identity.guiActionId,
    runId: identity.runId,
    loopId: identity.loopId,
    goalId: identity.goalId,
    taskId: identity.taskId,
    attemptId: identity.attemptId,
    source: identity.source,
  }
}
