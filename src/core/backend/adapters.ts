import { AgentKernel } from '../agent/index.js'
import { DurableRuntime } from '../durable/index.js'
import { GatewayDaemon } from '../gateway/index.js'
import { GuiRuntime } from '../gui/index.js'
import type { GuiRuntimeContext } from '../gui/index.js'
import { LoopRuntime } from '../loop/index.js'
import { ModelRouter } from '../model/index.js'
import { createCommandEnvelope } from '../protocol/index.js'
import { ReplayService } from '../replay/index.js'
import { asRecord, optionalString, requiredString } from './errors.js'
import { collectEventIds } from './telemetry.js'
import type {
  BackendAdapters,
  BackendExecution,
  BackendHandlerMap,
  BackendHandlerResult,
  BackendServiceOptions,
  NormalizedBackendRequest,
} from './types.js'

export function createBackendAdapters(options: BackendServiceOptions, context: { workspaceRoot: string; workspaceId: string; cwd: string; sessionId: string; source: BackendServiceOptions['source'] }): BackendAdapters {
  const durable = options.durable ?? new DurableRuntime({
    workspaceRoot: context.workspaceRoot,
    workspaceId: context.workspaceId,
  })
  const agent = options.agentKernel ?? new AgentKernel({
    cwd: context.cwd,
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
    commandSource: context.source ?? 'daemon',
    durable,
    config: options.config,
    fetch: options.fetch,
  })
  const loop = options.loopRuntime ?? new LoopRuntime({
    workspaceRoot: context.workspaceRoot,
    workspaceId: context.workspaceId,
    agentKernel: agent,
  })
  const gui = options.guiRuntime ?? new GuiRuntime({
    workspaceRoot: context.workspaceRoot,
    workspaceId: context.workspaceId,
    adapter: options.guiAdapter,
  })
  const gateway = options.gatewayDaemon ?? new GatewayDaemon({
    workspaceRoot: context.workspaceRoot,
    workspaceId: context.workspaceId,
  })
  const model = options.modelRouter ?? ModelRouter.fromConfig(options.config ?? {}, {
    workspaceRoot: context.workspaceRoot,
    workspaceId: context.workspaceId,
    durable,
  })
  const replay = options.replayService ?? new ReplayService(durable)
  return { durable, agent, loop, gui, gateway, model, replay }
}

export function createBackendHandlers(): BackendHandlerMap {
  return {
    'agent.run': handleAgentCommand,
    'agent.resume': handleAgentCommand,
    'agent.interrupt': handleAgentCommand,
    'loop.create': handleLoopCreate,
    'loop.runNext': handleLoopRunNext,
    'loop.status': handleLoopStatus,
    'loop.recover': handleLoopRecover,
    'gui.observe': handleGuiObserve,
    'gui.requestAction': handleGuiRequestAction,
    'gui.approve': handleGuiApprove,
    'gui.reject': handleGuiReject,
    'gateway.status': handleGatewayStatus,
    'gateway.tick': handleGatewayTick,
    'model.route': handleModelRoute,
    'model.status': handleModelStatus,
    'replay.run': handleReplayRun,
    'replay.loop': handleReplayLoop,
    'replay.export': handleReplayExport,
    'system.health': handleSystemHealth,
    'system.acceptance': handleSystemAcceptance,
  }
}

async function handleAgentCommand(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = request.payload ?? {}
  const payloadRecord = recordOrEmpty(payload)
  const command = createCommandEnvelope({
    commandId: request.requestId,
    commandType: request.action,
    workspaceId: execution.context.workspaceId,
    source: execution.context.source,
    threadId: optionalString(request.context.threadId) ?? optionalString(payloadRecord.threadId) ?? execution.context.threadId,
    runId: optionalString(request.context.runId) ?? optionalString(payloadRecord.runId) ?? execution.context.runId,
    goalId: optionalString(request.context.goalId) ?? optionalString(payloadRecord.goalId) ?? execution.context.goalId,
    loopId: optionalString(request.context.loopId) ?? optionalString(payloadRecord.loopId) ?? execution.context.loopId,
    createdAtMs: request.createdAtMs,
    payload,
  })
  const data = await execution.adapters.agent.submitRun(command)
  return { data, eventIds: collectEventIds(data) }
}

async function handleLoopCreate(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const data = await execution.adapters.loop.createLoop(asRecord(request.payload, 'payload') as Parameters<LoopRuntime['createLoop']>[0])
  return { data, eventIds: collectEventIds(data) }
}

async function handleLoopRunNext(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const data = await execution.adapters.loop.runNext(loopIdFrom(payload, request))
  return { data, eventIds: collectEventIds(data) }
}

async function handleLoopStatus(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const data = await execution.adapters.loop.status(loopIdFrom(payload, request))
  return { data, eventIds: collectEventIds(data) }
}

async function handleLoopRecover(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const data = await execution.adapters.loop.recoverLoop(loopIdFrom(payload, request))
  return { data, eventIds: collectEventIds(data) }
}

async function handleGuiObserve(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = recordOrEmpty(request.payload)
  const context = guiContext(payload.context ?? payload, request)
  const data = await execution.adapters.gui.observe(context)
  return { data, eventIds: collectEventIds(data) }
}

async function handleGuiRequestAction(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const action = asRecord(payload.action ?? payload, 'payload.action')
  const context = guiContext(payload.context, request)
  const data = await execution.adapters.gui.requestAction(action as Parameters<GuiRuntime['requestAction']>[0], context)
  return { data, eventIds: collectEventIds(data) }
}

async function handleGuiApprove(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const guiActionId = requiredString(payload.guiActionId ?? payload.actionId, 'payload.guiActionId')
  const data = await execution.adapters.gui.approveGuiAction(guiActionId, optionalString(payload.reason))
  return { data, eventIds: collectEventIds(data) }
}

async function handleGuiReject(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const guiActionId = requiredString(payload.guiActionId ?? payload.actionId, 'payload.guiActionId')
  const data = await execution.adapters.gui.rejectGuiAction(guiActionId, optionalString(payload.reason))
  return { data, eventIds: collectEventIds(data) }
}

async function handleGatewayStatus(_request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const data = await execution.adapters.gateway.status()
  return { data, eventIds: collectEventIds(data) }
}

async function handleGatewayTick(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const data = await execution.adapters.gateway.tick(recordOrEmpty(request.payload) as Parameters<GatewayDaemon['tick']>[0])
  return { data, eventIds: collectEventIds(data) }
}

async function handleModelRoute(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const data = await execution.adapters.model.route(asRecord(request.payload, 'payload') as Parameters<ModelRouter['route']>[0])
  return { data, eventIds: collectEventIds(data) }
}

async function handleModelStatus(_request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const [budget, providers, models, profiles, health] = await Promise.all([
    execution.adapters.model.readBudgetStatus(),
    Promise.resolve(execution.adapters.model.listProviders()),
    Promise.resolve(execution.adapters.model.listModels()),
    Promise.resolve(execution.adapters.model.listProfiles()),
    Promise.resolve(execution.adapters.model.readHealth()),
  ])
  const data = { providers, models, profiles, health, budget }
  return { data, eventIds: collectEventIds(data) }
}

async function handleReplayRun(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const data = await execution.adapters.replay.buildReport({
    ...payload,
    workspaceId: optionalString(payload.workspaceId) ?? execution.context.workspaceId,
    scope: replayScope(payload.scope, 'run'),
    caller: replayCaller(payload.caller),
  })
  return { data, eventIds: collectEventIds(data) }
}

async function handleReplayLoop(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const data = await execution.adapters.replay.buildReport({
    ...payload,
    workspaceId: optionalString(payload.workspaceId) ?? execution.context.workspaceId,
    scope: 'loop',
    loopId: optionalString(payload.loopId) ?? optionalString(payload.id) ?? request.context.loopId,
    caller: replayCaller(payload.caller),
  })
  return { data, eventIds: collectEventIds(data) }
}

async function handleReplayExport(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const payload = asRecord(request.payload, 'payload')
  const outputDir = requiredString(payload.outputDir, 'payload.outputDir')
  const query = asRecord(payload.query ?? payload, 'payload.query')
  const data = await execution.adapters.replay.exportBundle({
    ...query,
    workspaceId: optionalString(query.workspaceId) ?? execution.context.workspaceId,
    scope: replayScope(query.scope, 'run'),
    caller: replayCaller(query.caller),
  }, outputDir)
  return { data, eventIds: collectEventIds(data) }
}

async function handleSystemHealth(_request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const [maintenance, gateway] = await Promise.all([
    execution.adapters.durable.createMaintenanceReport(),
    execution.adapters.gateway.status().catch(error => ({ ok: false, message: error instanceof Error ? error.message : String(error) })),
  ])
  const data = {
    ok: true,
    workspaceId: execution.context.workspaceId,
    kernels: {
      agent: 'configured',
      durable: 'configured',
      loop: 'configured',
      gui: 'configured',
      gateway,
      model: {
        providerCount: execution.adapters.model.listProviders().length,
        modelCount: execution.adapters.model.listModels().length,
        health: execution.adapters.model.readHealth(),
      },
      replay: 'configured',
    },
    maintenance,
  }
  return { data, eventIds: collectEventIds(data) }
}

async function handleSystemAcceptance(_request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
  const data = {
    ok: true,
    workspaceId: execution.context.workspaceId,
    supportedActions: Object.keys(createBackendHandlers()),
    checks: {
      requestIdRequired: true,
      responseEventIdsRequired: true,
      serverIndependent: true,
      directImportPath: 'src/core/backend/index.ts',
    },
  }
  return { data, eventIds: collectEventIds(data) }
}

function loopIdFrom(payload: Record<string, unknown>, request: NormalizedBackendRequest): string {
  return requiredString(payload.loopId ?? payload.id ?? request.context.loopId, 'payload.loopId')
}

function guiContext(value: unknown, request: NormalizedBackendRequest): GuiRuntimeContext {
  const payload = recordOrEmpty(value)
  return {
    guiActionId: optionalString(payload.guiActionId),
    runId: optionalString(payload.runId) ?? request.context.runId,
    loopId: optionalString(payload.loopId) ?? request.context.loopId,
    goalId: optionalString(payload.goalId) ?? request.context.goalId,
    taskId: optionalString(payload.taskId),
    attemptId: optionalString(payload.attemptId),
    source: guiSource(optionalString(payload.source)),
    holder: optionalString(payload.holder),
  }
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function guiSource(value: string | undefined): GuiRuntimeContext['source'] | undefined {
  if (
    value === 'agent' ||
    value === 'loop' ||
    value === 'gateway' ||
    value === 'cli' ||
    value === 'web' ||
    value === 'test'
  ) {
    return value
  }
  return undefined
}

function replayScope(value: unknown, fallback: 'run' | 'loop'): 'run' | 'thread' | 'loop' | 'gui_action' | 'gateway_inbound' | 'gateway_delivery' | 'model_route' | 'time_range' {
  if (value === 'run' || value === 'thread' || value === 'loop' || value === 'gui_action' || value === 'gateway_inbound' || value === 'gateway_delivery' || value === 'model_route' || value === 'time_range') return value
  return fallback
}

function replayCaller(value: unknown): 'server' | 'gateway' | 'cli' | 'test' | 'maintenance' {
  if (value === 'server' || value === 'gateway' || value === 'cli' || value === 'test' || value === 'maintenance') return value
  return 'server'
}
