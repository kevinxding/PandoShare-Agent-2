import type { AgentKernel } from '../agent/index.js'
import type { DurableRuntime } from '../durable/index.js'
import type { GuiRuntime } from '../gui/index.js'
import type { LoopCommandHandler } from '../loop/index.js'
import type { CommandEnvelope } from '../protocol/index.js'
import { GATEWAY_EVENT_TYPES } from './GatewayEventTypes.js'
import type { GatewayCommandRoute } from './GatewayTypes.js'
import { GatewayApprovalBridge } from './GatewayApprovalBridge.js'

export type GatewayDispatchResult = {
  ok: boolean
  commandId: string
  commandType: string
  replyText: string
  runId?: string
  threadId?: string
  loopId?: string
  error?: string
}

export type GatewayDispatcherInput = {
  workspaceId: string
  durable: DurableRuntime
  agentKernel?: Pick<AgentKernel, 'submitRun'>
  loopCommandHandler?: Pick<LoopCommandHandler, 'handle'>
  guiRuntime?: Pick<GuiRuntime, 'approveGuiAction' | 'rejectGuiAction'>
  approvalBridge?: GatewayApprovalBridge
  statusProvider?: () => unknown | Promise<unknown>
  healthProvider?: () => unknown | Promise<unknown>
  usageProvider?: () => unknown | Promise<unknown>
  threadProvider?: () => unknown | Promise<unknown>
  replayProvider?: (targetId: string) => unknown | Promise<unknown>
  compactProvider?: (threadId: string) => unknown | Promise<unknown>
  backgroundEnroll?: (loopId: string) => unknown | Promise<unknown>
  modelProvider?: (input: { provider?: string; model?: string }) => unknown | Promise<unknown>
}

export class GatewayDispatcher {
  constructor(private readonly input: GatewayDispatcherInput) {}

  async dispatch(route: GatewayCommandRoute): Promise<GatewayDispatchResult> {
    const command = route.command
    try {
      const result = await this.dispatchCommand(command, route)
      await this.input.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.commandDispatched,
        workspaceId: this.input.workspaceId,
        runId: result.runId,
        threadId: result.threadId,
        loopId: result.loopId ?? command.loopId,
        payload: {
          commandId: command.commandId,
          commandType: command.commandType,
          ok: result.ok,
          replyPreview: preview(result.replyText),
        },
      })
      return result
    } catch (error) {
      const message = errorMessage(error)
      await this.input.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.commandFailed,
        workspaceId: this.input.workspaceId,
        loopId: command.loopId,
        payload: { commandId: command.commandId, commandType: command.commandType, message },
      })
      return { ok: false, commandId: command.commandId, commandType: command.commandType, replyText: `Command failed: ${message}`, error: message }
    }
  }

  private async dispatchCommand(command: CommandEnvelope, route: GatewayCommandRoute): Promise<GatewayDispatchResult> {
    if (command.commandType === 'gateway.command.unknown') return this.result(command, route.replyText ?? 'Unknown gateway command.', false)
    if (command.commandType === 'gateway.help') return this.result(command, route.replyText ?? 'Pando gateway help')
    if (command.commandType === 'gateway.status') return this.result(command, formatResult('Pando gateway status', await this.input.statusProvider?.()))
    if (command.commandType === 'gateway.health') return this.result(command, formatResult('Pando gateway health', await this.input.healthProvider?.()))
    if (command.commandType === 'gateway.usage') return this.result(command, formatResult('Pando gateway usage', await this.input.usageProvider?.()))
    if (command.commandType === 'thread.list') return this.result(command, formatResult('Pando threads', await this.input.threadProvider?.()))
    if (command.commandType === 'replay.read') {
      const targetId = stringPayload(command.payload, 'targetId') ?? ''
      return this.result(command, formatResult('Pando replay', await this.input.replayProvider?.(targetId)))
    }
    if (command.commandType === 'thread.compact') {
      const threadId = stringPayload(command.payload, 'threadId') ?? ''
      return this.result(command, formatResult('Pando compact', await this.input.compactProvider?.(threadId)))
    }
    if (command.commandType === 'gateway.background.enroll') {
      const loopId = requirePayload(command.payload, 'loopId')
      return this.result(command, formatResult('Pando background loop enrolled', await this.input.backgroundEnroll?.(loopId)), true, { loopId })
    }
    if (command.commandType === 'gateway.model.status' || command.commandType === 'gateway.model.switch') {
      return this.result(command, formatResult('Pando model', await this.input.modelProvider?.({ provider: stringPayload(command.payload, 'provider'), model: stringPayload(command.payload, 'model') })))
    }
    if (command.commandType === 'gateway.pair' || command.commandType === 'gateway.unpair' || command.commandType === 'gateway.stop') {
      return this.result(command, route.replyText ?? `queued ${command.commandType}`)
    }
    if (command.commandType === 'approval.resolve') {
      const resolved = await this.requireApprovalBridge().routeApprovalCommand(command)
      return this.result(command, resolved.message, resolved.ok)
    }
    if (command.commandType === 'gui.approve' || command.commandType === 'gui.reject') {
      const guiActionId = requirePayload(command.payload, 'guiActionId')
      if (!this.input.guiRuntime) return this.result(command, `GUI runtime is not configured for ${command.commandType}: ${guiActionId}`, false)
      const record = command.commandType === 'gui.approve'
        ? await this.input.guiRuntime.approveGuiAction(guiActionId, 'approved from gateway')
        : await this.input.guiRuntime.rejectGuiAction(guiActionId, 'denied from gateway')
      await this.input.durable.appendEvent({
        eventType: GATEWAY_EVENT_TYPES.guiApprovalForwarded,
        workspaceId: this.input.workspaceId,
        runId: record.identity.runId,
        loopId: record.identity.loopId,
        goalId: record.identity.goalId,
        payload: { guiActionId, commandId: command.commandId, decision: command.commandType === 'gui.approve' ? 'approve' : 'deny' },
      })
      return this.result(command, `${command.commandType === 'gui.approve' ? 'Approved' : 'Denied'} GUI action: ${guiActionId}`, true, { runId: record.identity.runId, loopId: record.identity.loopId })
    }
    if (command.commandType.startsWith('loop.')) {
      if (!this.input.loopCommandHandler) return this.result(command, `Loop runtime is not configured for ${command.commandType}.`, false)
      const loopResult = await this.input.loopCommandHandler.handle(command)
      return this.result(command, formatResult(command.commandType, loopResult.result), loopResult.ok, { loopId: command.loopId ?? stringPayload(command.payload, 'loopId') })
    }
    if (command.commandType === 'agent.run') {
      if (!this.input.agentKernel) return this.result(command, 'Agent kernel is not configured for agent.run.', false)
      const run = await this.input.agentKernel.submitRun(command)
      return this.result(command, `Agent run completed: ${run.runId}${run.threadId ? ` thread=${run.threadId}` : ''}\n${run.finalText}`, true, { runId: run.runId, threadId: run.threadId })
    }
    return this.result(command, route.replyText ?? `queued ${command.commandType}`)
  }

  private requireApprovalBridge(): GatewayApprovalBridge {
    if (!this.input.approvalBridge) throw new Error('Gateway approval bridge is not configured')
    return this.input.approvalBridge
  }

  private result(command: CommandEnvelope, replyText: string, ok = true, ids: { runId?: string; threadId?: string; loopId?: string } = {}): GatewayDispatchResult {
    return {
      ok,
      commandId: command.commandId,
      commandType: command.commandType,
      replyText,
      runId: ids.runId,
      threadId: ids.threadId,
      loopId: ids.loopId ?? command.loopId,
    }
  }
}

function formatResult(title: string, value: unknown): string {
  if (value === undefined) return title
  if (typeof value === 'string') return `${title}: ${value}`
  return `${title}: ${JSON.stringify(value)}`
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringPayload(value: unknown, key: string): string | undefined {
  const item = recordPayload(value)[key]
  return typeof item === 'string' && item.trim() ? item.trim() : undefined
}

function requirePayload(value: unknown, key: string): string {
  const item = stringPayload(value, key)
  if (!item) throw new Error(`Command payload requires ${key}`)
  return item
}

function preview(value: string, maxChars = 500): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
