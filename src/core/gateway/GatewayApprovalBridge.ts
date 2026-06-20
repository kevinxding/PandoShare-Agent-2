import type { DurableRuntime } from '../durable/index.js'
import { createCommandEnvelope, type CommandEnvelope } from '../protocol/index.js'
import { GATEWAY_EVENT_TYPES } from './GatewayEventTypes.js'

export type GatewayApprovalKind =
  | 'agent_tool_approval'
  | 'loop_human_gate'
  | 'gui_action_approval'
  | 'recovery_decision'
  | 'gateway_delivery_retry'
  | 'model_switch_request'

export type GatewayApproval = {
  approvalId: string
  kind: GatewayApprovalKind
  title: string
  summary: string
  createdAtMs: number
  runId?: string
  loopId?: string
  goalId?: string
  guiActionId?: string
  deliveryId?: string
  metadata?: Record<string, unknown>
}

export type GatewayApprovalDecision = 'approve' | 'deny'

export class GatewayApprovalBridge {
  constructor(private readonly input: {
    workspaceId: string
    durable: DurableRuntime
    seedApprovals?: readonly GatewayApproval[]
  }) {}

  async listPendingApprovals(): Promise<GatewayApproval[]> {
    const events = await this.input.durable.readEvents()
    const resolved = new Set<string>()
    for (const event of events) {
      if (event.eventType === GATEWAY_EVENT_TYPES.approvalResolved) {
        const id = stringPayload(event.payload, 'approvalId')
        if (id) resolved.add(id)
      }
      if (event.eventType === 'loop_human_gate_resolved') {
        const id = stringPayload(event.payload, 'gateId')
        if (id) resolved.add(id)
      }
      if (event.eventType === 'gui_action_approved' || event.eventType === 'gui_action_rejected') {
        const id = stringPayload(event.payload, 'guiActionId')
        if (id) resolved.add(id)
      }
    }
    const approvals = [...(this.input.seedApprovals ?? [])]
    for (const event of events) {
      if (event.eventType === 'loop_human_gate_requested') {
        const gateId = stringPayload(event.payload, 'gateId') ?? event.eventId
        approvals.push({
          approvalId: gateId,
          kind: 'loop_human_gate',
          title: 'Loop human gate',
          summary: stringPayload(event.payload, 'reason') ?? 'Loop is waiting for human approval.',
          createdAtMs: event.createdAtMs,
          loopId: event.loopId,
          goalId: event.goalId,
          metadata: safePayload(event.payload),
        })
      }
      if (event.eventType === 'gui_action_approval_required') {
        const guiActionId = stringPayload(event.payload, 'guiActionId') ?? event.eventId
        approvals.push({
          approvalId: guiActionId,
          kind: 'gui_action_approval',
          title: 'GUI action approval',
          summary: stringPayload(event.payload, 'action') ?? 'GUI action is waiting for approval.',
          createdAtMs: event.createdAtMs,
          runId: event.runId,
          loopId: event.loopId,
          goalId: event.goalId,
          guiActionId,
          metadata: safePayload(event.payload),
        })
      }
      if (event.eventType === GATEWAY_EVENT_TYPES.recoveryEscalated) {
        const approvalId = stringPayload(event.payload, 'approvalId') ?? stringPayload(event.payload, 'runId') ?? event.eventId
        approvals.push({
          approvalId,
          kind: 'recovery_decision',
          title: 'Recovery decision',
          summary: stringPayload(event.payload, 'reason') ?? 'Recovery requires human decision.',
          createdAtMs: event.createdAtMs,
          runId: event.runId ?? stringPayload(event.payload, 'runId'),
          metadata: safePayload(event.payload),
        })
      }
    }
    return approvals
      .filter(approval => !resolved.has(approval.approvalId))
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
  }

  async resolveApproval(id: string, decision: GatewayApprovalDecision, actor = 'gateway'): Promise<{ ok: boolean; message: string; approval?: GatewayApproval }> {
    const approval = (await this.listPendingApprovals()).find(item => item.approvalId === id)
    if (!approval) {
      return { ok: false, message: `Unknown approval id: ${id}` }
    }
    await this.input.durable.appendEvent({
      eventType: GATEWAY_EVENT_TYPES.approvalResolved,
      workspaceId: this.input.workspaceId,
      runId: approval.runId,
      loopId: approval.loopId,
      goalId: approval.goalId,
      payload: {
        approvalId: id,
        kind: approval.kind,
        decision,
        actor,
        resolvedAtMs: Date.now(),
      },
    })
    return { ok: true, message: `${decision === 'approve' ? 'Approved' : 'Denied'} approval: ${id}`, approval }
  }

  formatApprovalForChannel(approval: GatewayApproval): string {
    return [
      `Approval: ${approval.approvalId}`,
      `Kind: ${approval.kind}`,
      `Title: ${approval.title}`,
      `Summary: ${approval.summary}`,
    ].join('\n')
  }

  routeApprovalCommand(command: CommandEnvelope): Promise<{ ok: boolean; message: string; approval?: GatewayApproval }> {
    const payload = recordPayload(command.payload)
    const approvalId = stringPayload(payload, 'approvalId') ?? stringPayload(payload, 'targetId') ?? ''
    const rawDecision = stringPayload(payload, 'decision')
    const decision: GatewayApprovalDecision = rawDecision === 'deny' || rawDecision === 'reject' ? 'deny' : 'approve'
    return this.resolveApproval(approvalId, decision, command.source)
  }

  createResolveCommand(input: { approvalId: string; decision: GatewayApprovalDecision; source?: CommandEnvelope['source'] }): CommandEnvelope {
    return createCommandEnvelope({
      commandType: 'approval.resolve',
      workspaceId: this.input.workspaceId,
      source: input.source ?? 'gateway',
      payload: { approvalId: input.approvalId, decision: input.decision },
    })
  }
}

function safePayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (/token|secret|cookie|password|webhook/i.test(key)) continue
    out[key] = value
  }
  return out
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringPayload(value: unknown, key: string): string | undefined {
  const record = recordPayload(value)
  const item = record[key]
  return typeof item === 'string' && item.trim() ? item.trim() : undefined
}
