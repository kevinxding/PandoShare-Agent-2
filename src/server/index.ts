import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { platform } from 'node:os'

import { AgentKernel } from '../core/agent/index.js'
import { DurableRuntime } from '../core/durable/index.js'
import { ReplayService, type ReplayQuery } from '../core/replay/index.js'
import { MissionControlService } from '../core/mission-control/index.js'
import { GatewayDaemon } from '../core/gateway/index.js'
import {
  LocalApprovalStore,
  storedApprovalToDecision,
  type StoredApprovalDecision,
} from '../services/approvalStore/index.js'
import { createGuiBackendFromMcpConnections, diagnoseGuiBackend } from '../services/gui/index.js'
import { GatewayRuntime, LocalGatewayStore, type GatewayChannelConfig, type GatewayChannelKind } from '../services/gatewayRuntime/index.js'
import { LocalGoalStore } from '../services/goalStore/index.js'
import { GoalService } from '../services/goalService/index.js'
import { GoalRuntime } from '../services/goalRuntime/index.js'
import { LocalLoopStore, LoopRuntime, type LoopSpec, type LoopWorkspaceIsolation } from '../services/loopRuntime/index.js'
import { closeMcpConnections, summarizeMcpConnections } from '../services/mcp/index.js'
import { loadRuntimeConfig, runPreflight } from '../services/preflight/index.js'
import { LocalQuestionStore, type QuestionStatus } from '../services/questions/index.js'
import { LocalThreadStore, modelMetadata } from '../services/threadStore/index.js'
import { LocalTaskStore } from '../tasks/index.js'
import {
  builtinProviders,
  parseProjectConfig,
  redactProjectConfig,
  resolveDefaultModel,
  type ProjectConfig,
  type ProviderConfig,
} from '../services/config/index.js'
import { createRuntimeToolRegistry, type ToolRegistry } from '../tools.js'
import type { GenerateOptions } from '../services/llm/types.js'
import { previewText, type AgentEvent, type AgentEventHandler } from '../services/events/index.js'
import type { McpServerConnection } from '../services/mcp/index.js'
import type {
  ApprovalPolicy,
  ApprovalsReviewer,
  PermissionConfig,
  SandboxMode,
  ToolApprovalDecision,
  ToolApprovalRequest,
} from '../Tool.js'

export type PandoServerOptions = {
  cwd: string
  configPath?: string
  host?: string
  port?: number
  open?: boolean
  staticRoot?: string
  fetch?: GenerateOptions['fetch']
  stdout?: {
    write(text: string): void
  }
}

export type PandoServerHandle = {
  host: string
  port: number
  url: string
  close(): Promise<void>
}

type PendingApproval = {
  approvalId: string
  threadId: string
  request: ToolApprovalRequest
  resolve(decision: ToolApprovalDecision): void
}

type ActiveRun = {
  threadId: string
  abort(): void
}

type ActiveGatewayWorker = {
  sessionId: string
  startedAtMs: number
  status: 'running' | 'stopping' | 'stopped' | 'failed'
  gateway: GatewayRuntime
  promise: Promise<unknown>
  lastError?: string
}

type ServerRuntime = {
  cwd: string
  configPath?: string
  config: ProjectConfig
  registry: ToolRegistry
  mcpConnections: McpServerConnection[]
  broker: EventBroker
  approvalStore: LocalApprovalStore
  pendingApprovals: Map<string, PendingApproval>
  alwaysApprovedTools: Map<string, Set<string>>
  activeRuns: Map<string, ActiveRun>
  gatewayWorker?: ActiveGatewayWorker
  fetch?: GenerateOptions['fetch']
}

type ServerRuntimeProcess = {
  execPath?: string
  env?: Record<string, string | undefined>
  platform?: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const DEFAULT_HOST = '127.0.0.1'

export async function startPandoServer(options: PandoServerOptions): Promise<PandoServerHandle> {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? 8765
  const cwd = resolve(options.cwd)
  const loadedConfig = await loadRuntimeConfig(cwd, options.configPath)
  const { config } = loadedConfig
  const broker = new EventBroker()
  const approvalStore = new LocalApprovalStore(cwd)
  await approvalStore.ensure()
  const { registry, mcpConnections } = await createRuntimeToolRegistry({
    config,
    mcp: {
      sessionId: `server-${Date.now()}`,
      emitEvent: event => broker.publishGlobal(event),
    },
  })
  const runtime: ServerRuntime = {
    cwd,
    configPath: loadedConfig.configPath,
    config,
    registry,
    mcpConnections,
    broker,
    approvalStore,
    pendingApprovals: new Map(),
    alwaysApprovedTools: new Map(),
    activeRuns: new Map(),
    fetch: options.fetch,
  }
  const staticRoot = options.staticRoot ?? defaultStaticRoot()
  const server = createServer((request, response) => handleRequest(request, response, runtime, staticRoot))
  const address = await listen(server, port, host)
  const url = `http://${host}:${address.port}`

  if (options.open) openBrowser(url)
  options.stdout?.write(`Pando web GUI: ${url}\n`)

  return {
    host,
    port: address.port,
    url,
    async close() {
      closeMcpConnections(mcpConnections)
      for (const run of runtime.activeRuns.values()) run.abort()
      await stopGatewayWorker(runtime, 1000)
      for (const approval of runtime.pendingApprovals.values()) {
        const reason = 'Pando server closed before approval was answered.'
        await runtime.approvalStore.resolveApproval(approval.approvalId, {
          decision: 'cancel',
          reason,
          resolvedBy: 'web_server_close',
        })
        approval.resolve({ approved: false, reason })
      }
      runtime.pendingApprovals.clear()
      await closeServer(server)
    },
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  staticRoot: string,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/')) {
      await handleApiRequest(request, response, runtime, url)
      return
    }
    await serveStatic(response, staticRoot, url.pathname)
  } catch (error) {
    sendJson(response, 500, { ok: false, error: errorMessage(error) })
  }
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
): Promise<void> {
  const method = request.method ?? 'GET'

  if (url.pathname.startsWith('/api/mission-control')) {
    await handleMissionControlRequest(request, response, runtime, url)
    return
  }

  const replayRunMatch = url.pathname.match(/^\/api\/replay\/run\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && replayRunMatch) {
    await handleReplayRequest(response, runtime, url, { workspaceId: 'default', scope: 'run', runId: replayRunMatch[1]! })
    return
  }

  const replayThreadMatch = url.pathname.match(/^\/api\/replay\/thread\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && replayThreadMatch) {
    await handleReplayRequest(response, runtime, url, { workspaceId: 'default', scope: 'thread', threadId: replayThreadMatch[1]! })
    return
  }

  const replayLoopMatch = url.pathname.match(/^\/api\/replay\/loop\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && replayLoopMatch) {
    await handleReplayRequest(response, runtime, url, { workspaceId: 'default', scope: 'loop', loopId: replayLoopMatch[1]! })
    return
  }

  const replayGuiMatch = url.pathname.match(/^\/api\/replay\/gui\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && replayGuiMatch) {
    await handleReplayRequest(response, runtime, url, { workspaceId: 'default', scope: 'gui_action', guiActionId: replayGuiMatch[1]! })
    return
  }

  const replayGatewayMatch = url.pathname.match(/^\/api\/replay\/gateway\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && replayGatewayMatch) {
    const id = replayGatewayMatch[1]!
    await handleReplayRequest(response, runtime, url, id.startsWith('delivery_') ? { workspaceId: 'default', scope: 'gateway_delivery', deliveryId: id } : { workspaceId: 'default', scope: 'gateway_inbound', inboundId: id })
    return
  }

  const replayModelMatch = url.pathname.match(/^\/api\/replay\/model\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && replayModelMatch) {
    await handleReplayRequest(response, runtime, url, { workspaceId: 'default', scope: 'model_route', routeId: replayModelMatch[1]! })
    return
  }

  if (method === 'GET' && url.pathname === '/api/replay/incidents') {
    const runId = url.searchParams.get('runId') ?? undefined
    const loopId = url.searchParams.get('loopId') ?? undefined
    const query: Partial<ReplayQuery> = loopId ? { workspaceId: 'default', scope: 'loop', loopId } : { workspaceId: 'default', scope: 'run', runId }
    const service = new ReplayService(new DurableRuntime({ workspaceRoot: runtime.cwd, workspaceId: 'default' }))
    sendJson(response, 200, { ok: true, incidents: await service.detectIncidents(query) })
    return
  }

  if (method === 'POST' && url.pathname === '/api/replay/export') {
    await handleReplayExportRequest(request, response, runtime)
    return
  }
  if (method === 'GET' && url.pathname === '/api/doctor') {
    sendJson(response, 200, await runPreflight({ cwd: runtime.cwd, configPath: runtime.configPath }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/mcp') {
    sendJson(response, 200, summarizeMcpConnections(runtime.mcpConnections))
    return
  }

  if (method === 'GET' && url.pathname === '/api/gui') {
    const backend = createGuiBackendFromMcpConnections(runtime.mcpConnections)
    sendJson(response, 200, diagnoseGuiBackend(backend))
    return
  }

  if (method === 'GET' && url.pathname === '/api/tools') {
    sendJson(response, 200, buildToolsResponse(runtime))
    return
  }

  if (method === 'GET' && url.pathname === '/api/tasks') {
    await handleTaskListRequest(response, runtime, url)
    return
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && taskMatch) {
    await handleTaskDetailRequest(response, runtime, taskMatch[1]!)
    return
  }

  const taskOutputMatch = url.pathname.match(/^\/api\/tasks\/([A-Za-z0-9_-]+)\/output$/)
  if (method === 'GET' && taskOutputMatch) {
    await handleTaskOutputRequest(response, runtime, url, taskOutputMatch[1]!)
    return
  }

  const taskStopMatch = url.pathname.match(/^\/api\/tasks\/([A-Za-z0-9_-]+)\/stop$/)
  if (method === 'POST' && taskStopMatch) {
    await handleTaskStopRequest(request, response, runtime, taskStopMatch[1]!)
    return
  }

  if (method === 'GET' && url.pathname === '/api/questions') {
    await handleQuestionListRequest(response, runtime, url)
    return
  }

  const questionMatch = url.pathname.match(/^\/api\/questions\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && questionMatch) {
    await handleQuestionDetailRequest(response, runtime, questionMatch[1]!)
    return
  }

  const questionAnswerMatch = url.pathname.match(/^\/api\/questions\/([A-Za-z0-9_-]+)\/answer$/)
  if (method === 'POST' && questionAnswerMatch) {
    await handleQuestionAnswerRequest(request, response, runtime, questionAnswerMatch[1]!)
    return
  }

  if (method === 'GET' && url.pathname === '/api/settings') {
    sendJson(response, 200, await buildSettingsResponse(runtime))
    return
  }

  if (method === 'GET' && url.pathname === '/api/acceptance') {
    sendJson(response, 200, await buildAcceptanceResponse(runtime.cwd))
    return
  }

  if (method === 'POST' && url.pathname === '/api/acceptance/run') {
    await handleAcceptanceRunRequest(request, response, runtime)
    return
  }

  if (method === 'GET' && url.pathname === '/api/goals') {
    const store = new LocalGoalStore(runtime.cwd)
    sendJson(response, 200, await store.listGoals())
    return
  }

  if (method === 'POST' && url.pathname === '/api/goals') {
    await handleGoalCreateRequest(request, response, runtime)
    return
  }

  if (method === 'GET' && url.pathname === '/api/goals/active') {
    const store = new LocalGoalStore(runtime.cwd)
    sendJson(response, 200, { ok: true, goal: await store.activeGoal() })
    return
  }

  const goalMatch = url.pathname.match(/^\/api\/goals\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && goalMatch) {
    const store = new LocalGoalStore(runtime.cwd)
    sendJson(response, 200, await store.readExport(goalMatch[1]!))
    return
  }

  const goalActionMatch = url.pathname.match(/^\/api\/goals\/([A-Za-z0-9_-]+)\/(resume|continue|pause|block|complete)$/)
  if (method === 'POST' && goalActionMatch) {
    await handleGoalActionRequest(request, response, runtime, goalActionMatch[1]!, goalActionMatch[2]!)
    return
  }

  if (method === 'POST' && url.pathname === '/api/settings/model') {
    await handleModelSettingsRequest(request, response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/settings/runtime') {
    await handleRuntimeSettingsRequest(request, response, runtime)
    return
  }

  if (method === 'GET' && url.pathname === '/api/files') {
    await handleFilesRequest(response, runtime, url)
    return
  }

  if (method === 'POST' && url.pathname === '/api/stop') {
    await handleStopRequest(request, response, runtime)
    return
  }

  if (method === 'GET' && url.pathname === '/api/loops') {
    const store = new LocalLoopStore(runtime.cwd)
    sendJson(response, 200, await store.listSummaries())
    return
  }

  if (method === 'POST' && url.pathname === '/api/loops') {
    await handleLoopCreateRequest(request, response, runtime)
    return
  }

  const loopMatch = url.pathname.match(/^\/api\/loops\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && loopMatch) {
    const store = new LocalLoopStore(runtime.cwd)
    sendJson(response, 200, await store.readExport(loopMatch[1]!))
    return
  }

  const loopActionMatch = url.pathname.match(/^\/api\/loops\/([A-Za-z0-9_-]+)\/(run|resume|pause|stop)$/)
  if (method === 'POST' && loopActionMatch) {
    await handleLoopActionRequest(request, response, runtime, loopActionMatch[1]!, loopActionMatch[2]!)
    return
  }

  if (method === 'GET' && url.pathname === '/api/gateway/status') {
    await handleGatewayV2StatusRequest(response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/tick') {
    await handleGatewayV2TickRequest(request, response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/approve') {
    await handleGatewayV2ApprovalRequest(request, response, runtime, 'approve')
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/deny') {
    await handleGatewayV2ApprovalRequest(request, response, runtime, 'deny')
    return
  }
  if (method === 'GET' && url.pathname === '/api/gateway') {
    await handleGatewayStatusRequest(response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/start') {
    await handleGatewayV2StartRequest(request, response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/recover') {
    await handleGatewayRecoverRequest(request, response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/stop') {
    await handleGatewayV2StopRequest(response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/message') {
    await handleGatewayMessageRequest(request, response, runtime)
    return
  }

  if (method === 'POST' && url.pathname === '/api/gateway/inbound') {
    await handleGatewayV2InboundRequest(request, response, runtime)
    return
  }

  if (method === 'GET' && url.pathname === '/api/threads') {
    const store = new LocalThreadStore(runtime.cwd)
    sendJson(response, 200, await store.listThreadSummaries())
    return
  }

  if (method === 'POST' && url.pathname === '/api/threads') {
    const body = await readJsonBody(request)
    const sessionId = `web-${Date.now()}`
    const store = new LocalThreadStore(runtime.cwd)
    const model = modelMetadata(resolveModel(runtime.config))
    const record = await store.createThread({
      sessionId,
      cwd: runtime.cwd,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
      model,
      permissions: runtime.config.permissions,
      goalId: typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined,
    })
    sendJson(response, 200, record.metadata)
    return
  }

  const threadModelMatch = url.pathname.match(/^\/api\/threads\/([A-Za-z0-9_-]+)\/model$/)
  if (method === 'POST' && threadModelMatch) {
    await handleThreadModelRequest(request, response, runtime, threadModelMatch[1]!)
    return
  }

  const threadRenameMatch = url.pathname.match(/^\/api\/threads\/([A-Za-z0-9_-]+)\/rename$/)
  if (method === 'POST' && threadRenameMatch) {
    await handleThreadRenameRequest(request, response, runtime, threadRenameMatch[1]!)
    return
  }

  const threadBranchMatch = url.pathname.match(/^\/api\/threads\/([A-Za-z0-9_-]+)\/branch$/)
  if (method === 'POST' && threadBranchMatch) {
    await handleThreadBranchRequest(request, response, runtime, threadBranchMatch[1]!)
    return
  }

  const threadExportMatch = url.pathname.match(/^\/api\/threads\/([A-Za-z0-9_-]+)\/export$/)
  if (method === 'GET' && threadExportMatch) {
    await handleThreadExportRequest(response, runtime, url, threadExportMatch[1]!)
    return
  }

  const threadMatch = url.pathname.match(/^\/api\/threads\/([A-Za-z0-9_-]+)$/)
  if (method === 'GET' && threadMatch) {
    const store = new LocalThreadStore(runtime.cwd)
    sendJson(response, 200, await store.readThreadExport(threadMatch[1]!))
    return
  }

  if (method === 'POST' && url.pathname === '/api/chat') {
    await handleChatRequest(request, response, runtime)
    return
  }

  if (method === 'GET' && url.pathname === '/api/events') {
    await handleEventsRequest(request, response, runtime, url)
    return
  }

  const approvalMatch = url.pathname.match(/^\/api\/approval\/([A-Za-z0-9_-]+)$/)
  if (method === 'POST' && approvalMatch) {
    await handleApprovalRequest(request, response, runtime, approvalMatch[1]!)
    return
  }

  sendJson(response, 404, { ok: false, error: `Unknown API route: ${method} ${url.pathname}` })
}

async function handleMissionControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
): Promise<void> {
  const method = request.method ?? 'GET'
  const service = new MissionControlService({ workspaceRoot: runtime.cwd, cwd: runtime.cwd, sessionId: 'server-mission-control' })
  try {
    if (method === 'GET' && url.pathname === '/api/mission-control/overview') {
      sendJson(response, 200, service.getOverview())
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/active') {
      sendJson(response, 200, service.getActiveWork())
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/health') {
      sendJson(response, 200, service.getRuntimeHealth())
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/runs') {
      sendJson(response, 200, service.getRuns(queryFromUrl(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/loops') {
      sendJson(response, 200, service.getLoops(queryFromUrl(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/gateway') {
      sendJson(response, 200, service.getGatewayStatus())
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/gui') {
      sendJson(response, 200, service.getGuiStatus())
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/models') {
      sendJson(response, 200, service.getModelStatus())
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/replay') {
      sendJson(response, 200, service.getReplaySummary(queryFromUrl(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/approvals') {
      sendJson(response, 200, service.getApprovals(queryFromUrl(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/api/mission-control/events') {
      sendJson(response, 200, service.getEvents(queryFromUrl(url)))
      return
    }
    if (method === 'POST' && url.pathname === '/api/mission-control/action') {
      const body = await readJsonBody(request)
      const action = typeof body.action === 'string' ? body.action : ''
      const payload = isRecord(body.payload) ? body.payload : {}
      const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
      sendJson(response, 200, await service.runAction({ action, payload, requestId }))
      return
    }
    sendJson(response, 404, { ok: false, error: 'Unknown Mission Control route: ' + method + ' ' + url.pathname })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
  }
}

function queryFromUrl(url: URL): { limit?: number; status?: string } {
  const limitValue = url.searchParams.get('limit')
  const limit = limitValue ? Number(limitValue) : undefined
  const status = url.searchParams.get('status') ?? undefined
  return {
    limit: Number.isFinite(limit) && limit !== undefined ? limit : undefined,
    status,
  }
}

async function handleReplayRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
  query: Partial<ReplayQuery>,
): Promise<void> {
  try {
    const service = new ReplayService(new DurableRuntime({ workspaceRoot: runtime.cwd, workspaceId: 'default' }))
    if (url.searchParams.get('format') === 'markdown') {
      sendText(response, 200, await service.buildMarkdown({ ...query, redaction: 'strict' }), 'text/markdown; charset=utf-8')
      return
    }
    sendJson(response, 200, { ok: true, report: await service.buildJson({ ...query, redaction: 'strict' }) })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
  }
}

async function handleReplayExportRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  try {
    const body = await readJsonBody(request)
    const runId = typeof body.runId === 'string' ? body.runId : undefined
    const loopId = typeof body.loopId === 'string' ? body.loopId : undefined
    const out = typeof body.out === 'string' && body.out.trim() ? body.out.trim() : `.pandoshare/replay/export-${runId ?? loopId ?? Date.now()}`
    const outputDir = resolveReplayOutputPath(runtime.cwd, out)
    const query: Partial<ReplayQuery> = loopId ? { workspaceId: 'default', scope: 'loop', loopId } : { workspaceId: 'default', scope: 'run', runId }
    const service = new ReplayService(new DurableRuntime({ workspaceRoot: runtime.cwd, workspaceId: 'default' }))
    sendJson(response, 200, { ok: true, export: await service.exportBundle(query, outputDir) })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
  }
}
function resolveReplayOutputPath(workspaceRoot: string, outputPath: string): string {
  const workspace = resolve(workspaceRoot)
  const target = resolve(workspace, outputPath)
  const relativePath = relative(workspace, target)
  if (relativePath === '' || relativePath.startsWith('..')) throw new Error('replay export path must stay inside the workspace')
  return target
}
async function buildSettingsResponse(runtime: ServerRuntime): Promise<Record<string, unknown>> {
  return {
    ok: true,
    cwd: runtime.cwd,
    configPath: runtime.configPath,
    config: redactProjectConfig(runtime.config),
    model: modelMetadata(resolveModel(runtime.config)),
    modelSettings: buildModelSettings(runtime.config),
    permissions: runtime.config.permissions,
    gateway: runtime.config.gateway,
    mcp: summarizeMcpConnections(runtime.mcpConnections),
    gui: diagnoseGuiBackend(createGuiBackendFromMcpConnections(runtime.mcpConnections)),
    activeRuns: [...runtime.activeRuns.keys()],
    pendingApprovalCount: (await runtime.approvalStore.readPending()).length,
  }
}

async function buildAcceptanceResponse(cwd: string): Promise<Record<string, unknown>> {
  const acceptanceRoot = resolve(cwd, '.pandoshare/acceptance')
  if (!isInside(cwd, acceptanceRoot)) {
    return { ok: false, status: 'failed', error: 'acceptance path must stay inside the workspace' }
  }

  let names: string[]
  try {
    names = await readdir(acceptanceRoot)
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: true,
        status: 'missing',
        acceptanceRoot,
        latest: undefined,
        runs: [],
      }
    }
    throw error
  }

  const runs = []
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue
    const summaryPath = resolve(acceptanceRoot, name, 'summary.json')
    if (!isInside(cwd, summaryPath)) continue
    try {
      const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>
      runs.push(summarizeAcceptanceRun(summary, summaryPath))
    } catch {
      runs.push({
        runId: name,
        profile: 'unknown',
        status: 'unreadable',
        startedAtMs: 0,
        finishedAtMs: 0,
        selectedStepCount: 0,
        totalStepCount: 0,
        passedStepCount: 0,
        failedStepCount: 1,
        durationMs: 0,
        summaryPath,
        reportPath: join(dirname(summaryPath), 'report.md'),
        failedSteps: ['summary'],
        steps: [],
      })
    }
  }

  runs.sort((left, right) => Number(right.finishedAtMs ?? right.startedAtMs ?? 0) - Number(left.finishedAtMs ?? left.startedAtMs ?? 0))
  const latest = runs[0]
  return {
    ok: true,
    status: latest?.status ?? 'missing',
    acceptanceRoot,
    latest,
    runs: runs.slice(0, 12),
  }
}

async function handleGoalCreateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (!objective) {
    sendJson(response, 400, { ok: false, error: 'objective must be a non-empty string' })
    return
  }
  const requirements = Array.isArray(body.requirements)
    ? body.requirements.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim())
    : typeof body.requirements === 'string'
      ? body.requirements.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
      : undefined
  const service = new GoalService(new LocalGoalStore(runtime.cwd))
  const summary = await service.createGoal({
    goalId: typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined,
    sessionId: `web-goal-${Date.now()}`,
    cwd: runtime.cwd,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
    objective,
    requirements,
  })
  sendJson(response, 200, { ok: true, summary })
}

async function handleGoalActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  goalId: string,
  action: string,
): Promise<void> {
  const body = await readJsonBody(request)
  const store = new LocalGoalStore(runtime.cwd)
  const service = new GoalService(store)
  try {
    if (action === 'continue') {
      const goalRuntime = new GoalRuntime(store)
      const output = await goalRuntime.continueGoal(goalId, {
        sessionId: `web-goal-runtime-${Date.now()}`,
        idle: false,
      })
      sendJson(response, 200, { ok: output.ok, output, summary: output.goal ?? await service.readSummary(goalId) })
      return
    }

    const summary = action === 'complete'
      ? await service.completeGoal(goalId)
      : action === 'resume'
        ? await service.resumeGoal(goalId, 'Goal resumed from Web GUI.')
        : action === 'pause'
          ? await service.pauseGoal(goalId, 'Goal paused from Web GUI.')
          : await service.blockGoal(
            goalId,
            typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Goal blocked from Web GUI.',
            'user',
          )
    sendJson(response, 200, { ok: true, summary })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
  }
}

function buildToolsResponse(runtime: ServerRuntime): Record<string, unknown> {
  const tools = runtime.registry.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    safety: tool.safety,
    platforms: tool.platforms ?? ['all'],
    behavior: tool.behavior ?? {},
    concurrency: tool.concurrency ?? (tool.safety === 'read_only' ? 'safe' : 'serial'),
    inputSchema: tool.inputSchema ?? {},
    source: tool.name.startsWith('mcp__') ? 'mcp' : 'pando',
  }))
  const bySafety = tools.reduce<Record<string, number>>((accumulator, tool) => {
    accumulator[tool.safety] = (accumulator[tool.safety] ?? 0) + 1
    return accumulator
  }, {})
  return {
    ok: true,
    count: tools.length,
    bySafety,
    tools,
  }
}

async function handleTaskListRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
): Promise<void> {
  const store = new LocalTaskStore(runtime.cwd)
  const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 200)
  const status = url.searchParams.get('status') || undefined
  const goalId = url.searchParams.get('goalId') || undefined
  const tasks = (await store.listTasks())
    .filter(task => !status || task.status === status)
    .filter(task => !goalId || task.goalId === goalId)
    .slice(0, limit)
  const previews = await Promise.all(tasks.map(async task => {
    const output = await store.readOutput(task.taskId, 1200).catch(() => ({ text: '', truncated: false }))
    return {
      ...task,
      outputPreview: output.text,
      outputTruncated: output.truncated,
    }
  }))
  sendJson(response, 200, {
    ok: true,
    tasks: previews,
    count: previews.length,
  })
}

async function handleTaskDetailRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  taskId: string,
): Promise<void> {
  try {
    const store = new LocalTaskStore(runtime.cwd)
    const task = await store.readTask(taskId)
    const output = await store.readOutput(taskId, 20_000).catch(() => ({ text: '', truncated: false }))
    sendJson(response, 200, { ok: true, task, output: output.text, outputTruncated: output.truncated })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleTaskOutputRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
  taskId: string,
): Promise<void> {
  try {
    const maxChars = boundedInteger(url.searchParams.get('maxChars'), 20_000, 1, 100_000)
    const output = await new LocalTaskStore(runtime.cwd).readOutput(taskId, maxChars)
    sendJson(response, 200, { ok: true, taskId, output: output.text, truncated: output.truncated })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleTaskStopRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  taskId: string,
): Promise<void> {
  try {
    const body = await readJsonBody(request)
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Stopped from Web UI.'
    const task = await new LocalTaskStore(runtime.cwd).stopTask(taskId, reason)
    sendJson(response, 200, { ok: true, task })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
  }
}

async function handleQuestionListRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
): Promise<void> {
  const status = parseQuestionStatus(url.searchParams.get('status'))
  const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 200)
  const questions = await new LocalQuestionStore(runtime.cwd).listQuestions({ status, limit })
  sendJson(response, 200, {
    ok: true,
    questions,
    count: questions.length,
    waitingCount: questions.filter(question => question.status === 'waiting' || question.status === 'queued').length,
  })
}

async function handleQuestionDetailRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  questionId: string,
): Promise<void> {
  try {
    const question = await new LocalQuestionStore(runtime.cwd).readQuestion(questionId)
    sendJson(response, 200, { ok: true, question })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleQuestionAnswerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  questionId: string,
): Promise<void> {
  try {
    const body = await readJsonBody(request)
    const answer = typeof body.answer === 'string' && body.answer.trim() ? body.answer.trim() : ''
    if (!answer) {
      sendJson(response, 400, { ok: false, error: 'answer must be a non-empty string' })
      return
    }
    const answeredBy = typeof body.answeredBy === 'string' && body.answeredBy.trim() ? body.answeredBy.trim() : 'web'
    const question = await new LocalQuestionStore(runtime.cwd).answerQuestion(questionId, answer, answeredBy)
    sendJson(response, 200, { ok: true, question })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
  }
}

function parseQuestionStatus(value: string | null): QuestionStatus | undefined {
  if (!value) return undefined
  if (value === 'waiting' || value === 'queued' || value === 'answered' || value === 'expired') return value
  return undefined
}

function summarizeAcceptanceRun(summary: Record<string, unknown>, summaryPath: string): Record<string, unknown> {
  const steps = Array.isArray(summary.steps) ? summary.steps.filter(isRecord) : []
  const failedSteps = steps
    .filter(step => step.status !== 'passed' && step.status !== 'skipped')
    .map(step => String(step.id ?? 'unknown'))
  const startedAtMs = numericValue(summary.startedAtMs)
  const finishedAtMs = numericValue(summary.finishedAtMs)
  return {
    runId: String(summary.runId ?? 'unknown'),
    profile: String(summary.profile ?? 'unknown'),
    status: String(summary.status ?? 'unknown'),
    startedAtMs,
    finishedAtMs,
    selectedStepCount: numericValue(summary.selectedStepCount),
    totalStepCount: numericValue(summary.totalStepCount),
    passedStepCount: steps.filter(step => step.status === 'passed').length,
    failedStepCount: failedSteps.length,
    durationMs: startedAtMs && finishedAtMs ? finishedAtMs - startedAtMs : 0,
    evidenceRoot: typeof summary.evidenceRoot === 'string' ? summary.evidenceRoot : dirname(summaryPath),
    summaryPath,
    reportPath: join(dirname(summaryPath), 'report.md'),
    failedSteps,
    steps: steps.map(step => ({
      id: String(step.id ?? 'unknown'),
      status: String(step.status ?? 'unknown'),
      durationMs: numericValue(step.durationMs),
      command: typeof step.command === 'string' ? step.command : '',
    })).slice(0, 40),
  }
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function handleAcceptanceRunRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const mode = body.mode === 'quick' ? 'quick' : 'dry_run'
  const profile = body.profile === 'full' ? 'full' : 'required'
  const only = mode === 'quick'
    ? parseAcceptanceOnly(body.only).slice(0, 4)
    : []
  const selectedOnly = only.length ? only : mode === 'quick' ? ['typecheck', 'check'] : []
  const timeoutMs = boundedInteger(body.timeoutMs, 180_000, 10_000, 240_000)
  const runId = `web_acceptance_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const packageRoot = defaultPackageRoot()
  const scriptPath = resolve(packageRoot, 'scripts/acceptance-smoke.mjs')
  if (!isInside(packageRoot, scriptPath)) {
    sendJson(response, 403, { ok: false, error: 'acceptance script must stay inside the Pando package' })
    return
  }

  const args = [scriptPath, '--profile', profile, '--run-id', runId, '--timeout-ms', String(timeoutMs)]
  if (mode === 'dry_run') args.push('--dry-run')
  if (selectedOnly.length) args.push('--only', selectedOnly.join(','))

  const runtimeProcess = getServerRuntimeProcess()
  const result = await runChildProcess(runtimeProcess.execPath ?? 'node', args, runtime.cwd, timeoutMs + 30_000)
  const acceptance = await buildAcceptanceResponse(runtime.cwd)
  const goalId = typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined
  if (goalId) {
    const goalStore = new LocalGoalStore(runtime.cwd)
    const latestAcceptance = isRecord(acceptance.latest) ? acceptance.latest : undefined
    if (result.exitCode === 0 && !result.timedOut) {
      await goalStore.appendEvidence(goalId, {
        type: 'acceptance',
        strength: 'direct',
        summary: `Acceptance ${mode} passed: ${runId}`,
        acceptanceRunId: runId,
        requirementIds: parseGoalRequirementIds(body.requirementIds),
        path: typeof latestAcceptance?.reportPath === 'string' ? latestAcceptance.reportPath : undefined,
      })
    } else {
      await goalStore.appendProgress(goalId, `Acceptance ${mode} did not pass: ${runId}`)
    }
  }
  sendJson(response, 200, {
    ok: result.exitCode === 0 && !result.timedOut,
    mode,
    runId,
    profile,
    only: selectedOnly,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdoutPreview: previewTail(result.stdout),
    stderrPreview: previewTail(result.stderr),
    acceptance,
  })
}

function parseGoalRequirementIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const ids = raw
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => /^[A-Za-z0-9_-]+$/.test(item))
  return ids.length ? ids : undefined
}

function parseAcceptanceOnly(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const allowed = new Set([
    'typecheck',
    'build',
    'check',
    'web-build',
    'cli-entry-smoke',
    'doctor-smoke',
    'model-smoke',
    'mcp-client-smoke',
    'gui-tool-smoke',
    'gateway-smoke',
    'loop-runtime-smoke',
    'harness-smoke',
    'thread-store-smoke',
    'thread-commands-smoke',
    'compact-smoke',
    'events-smoke',
    'permissions-smoke',
    'approval-web-smoke',
    'stability-smoke',
  ])
  return raw
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => /^[A-Za-z0-9_-]+$/.test(item) && allowed.has(item))
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function runChildProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{
  exitCode: number | null
  signal?: string | null
  timedOut: boolean
  stdout: string
  stderr: string
}> {
  return new Promise(resolveRun => {
    const runtimeProcess = getServerRuntimeProcess()
    const child = spawn(command, args, {
      cwd,
      env: runtimeProcess.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const timeout = setTimeout(() => {
      timedOut = true
      void terminateChildTree(child)
    }, timeoutMs)
    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({
        exitCode: 1,
        signal: undefined,
        timedOut,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${errorMessage(error)}`,
      })
    })
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({ exitCode, signal, timedOut, stdout, stderr })
    })
  })
}

function terminateChildTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return Promise.resolve()
  const runtimeProcess = getServerRuntimeProcess()
  if (runtimeProcess.platform !== 'win32') {
    child.kill('SIGTERM')
    return Promise.resolve()
  }
  return new Promise(resolveKill => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    })
    killer.on('close', () => resolveKill())
    killer.on('error', () => {
      child.kill()
      resolveKill()
    })
  })
}

function previewTail(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= 2000 ? trimmed : trimmed.slice(-2000)
}

function getServerRuntimeProcess(): ServerRuntimeProcess {
  const runtime = globalThis as unknown as { process?: ServerRuntimeProcess }
  return runtime.process ?? {}
}

async function handleModelSettingsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const providerId = typeof body.provider === 'string' ? body.provider.trim() : ''
  if (!/^[A-Za-z0-9_-]+$/.test(providerId)) {
    sendJson(response, 400, { ok: false, error: 'provider must be an ASCII provider id' })
    return
  }

  const nextConfig = cloneConfig(runtime.config)
  const modelName = optionalTrimmedString(body.modelName ?? body.model)
  nextConfig.model = {
    ...(nextConfig.model ?? {}),
    provider: providerId,
    name: modelName,
  }

  const providerPatch = buildProviderPatch(providerId, body, modelName, nextConfig.providers?.[providerId])
  if (providerPatch) {
    nextConfig.providers = {
      ...(nextConfig.providers ?? {}),
      [providerId]: providerPatch,
    }
  }

  if (!(await persistRuntimeConfig(response, runtime, nextConfig))) return
  sendJson(response, 200, await buildSettingsResponse(runtime))
}

async function handleRuntimeSettingsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const nextConfig = cloneConfig(runtime.config)

  let validated: ProjectConfig
  try {
    nextConfig.permissions = buildPermissionSettingsPatch(body, nextConfig.permissions)
    nextConfig.gateway = {
      ...(nextConfig.gateway ?? {}),
      ...buildGatewaySettingsPatch(body),
    }
    validated = parseProjectConfig(`${JSON.stringify(nextConfig, null, 2)}\n`, runtime.configPath ?? 'pandoshare.config.json')
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
    return
  }

  if (!(await persistRuntimeConfig(response, runtime, validated))) return
  sendJson(response, 200, await buildSettingsResponse(runtime))
}

async function persistRuntimeConfig(
  response: ServerResponse,
  runtime: ServerRuntime,
  nextConfig: ProjectConfig,
): Promise<boolean> {
  const configPath = runtime.configPath ? resolve(runtime.configPath) : resolve(runtime.cwd, 'pandoshare.config.json')
  if (!isInside(runtime.cwd, configPath)) {
    sendJson(response, 403, { ok: false, error: 'Web settings can only write a config file inside the workspace' })
    return false
  }

  let validated: ProjectConfig
  try {
    validated = parseProjectConfig(`${JSON.stringify(nextConfig, null, 2)}\n`, configPath)
    resolveDefaultModel(validated)
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
    return false
  }

  await writeFile(configPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  runtime.config = validated
  runtime.configPath = configPath
  return true
}

function buildModelSettings(config: ProjectConfig): Record<string, unknown> {
  const activeModel = resolveModel(config)
  const providerIds = new Set<string>([
    ...Object.values(builtinProviders).map(provider => provider.id),
    'custom',
    ...Object.keys(config.providers ?? {}),
  ])
  const catalog = [...providerIds].sort().map(providerId => {
    if (providerId === 'custom' && !config.providers?.custom) {
      return {
        id: 'custom',
        name: 'Custom OpenAI-Compatible Provider',
        defaultModel: 'custom-model',
        model: 'custom-model',
        baseURL: '',
        protocol: 'openai-chat-completions',
        authType: 'api-key',
        authEnvKeys: ['CUSTOM_LLM_API_KEY'],
        configured: false,
        builtin: false,
        capabilities: fallbackProviderCapabilities(providerId),
      }
    }
    try {
      const resolved = resolveDefaultModel({
        ...config,
        model: {
          ...(config.model ?? {}),
          provider: providerId,
          name: undefined,
        },
      })
      return {
        id: resolved.provider.id,
        name: resolved.provider.name,
        defaultModel: resolved.provider.defaultModel,
        model: resolved.model ?? resolved.provider.defaultModel,
        baseURL: resolved.provider.baseURL,
        protocol: resolved.provider.wireProtocol,
        authType: resolved.provider.auth.type,
        authEnvKeys: resolved.provider.auth.type === 'none' ? [] : resolved.provider.auth.envKeys,
        configured: Boolean(config.providers?.[providerId]),
        builtin: isBuiltinProviderId(providerId),
        capabilities: resolved.provider.capabilities,
      }
    } catch (error) {
      return {
        id: providerId,
        name: providerId,
        defaultModel: config.providers?.[providerId]?.model ?? 'unknown',
        model: config.providers?.[providerId]?.model ?? 'unknown',
        baseURL: config.providers?.[providerId]?.baseURL,
        protocol: config.providers?.[providerId]?.protocol ?? 'openai-chat-completions',
        authType: config.providers?.[providerId]?.auth?.type ?? 'api-key',
        authEnvKeys: normalizeDisplayEnvKeys(config.providers?.[providerId]),
        configured: Boolean(config.providers?.[providerId]),
        builtin: isBuiltinProviderId(providerId),
        error: errorMessage(error),
        capabilities: fallbackProviderCapabilities(providerId),
      }
    }
  })

  return {
    active: {
      provider: activeModel.provider.id,
      name: activeModel.provider.name,
      model: activeModel.model ?? activeModel.provider.defaultModel,
      baseURL: activeModel.provider.baseURL,
      protocol: activeModel.provider.wireProtocol,
      authType: activeModel.provider.auth.type,
      authEnvKeys: activeModel.provider.auth.type === 'none' ? [] : activeModel.provider.auth.envKeys,
      capabilities: activeModel.provider.capabilities,
    },
    catalog,
  }
}

function buildProviderPatch(
  providerId: string,
  body: Record<string, unknown>,
  modelName: string | undefined,
  existing: ProviderConfig | undefined,
): ProviderConfig | undefined {
  const providerName = optionalTrimmedString(body.providerName)
  const baseURL = optionalTrimmedString(body.baseURL)
  const apiKeyEnv = optionalTrimmedString(body.apiKeyEnv)
  const protocol = optionalTrimmedString(body.protocol)
  const authType = optionalTrimmedString(body.authType)
  const shouldPersist =
    !isBuiltinProviderId(providerId) ||
    providerName !== undefined ||
    baseURL !== undefined ||
    apiKeyEnv !== undefined ||
    protocol !== undefined ||
    authType !== undefined

  if (!shouldPersist) return undefined

  const patch: ProviderConfig = {
    ...(existing ?? {}),
  }
  if (providerName !== undefined) patch.name = providerName
  if (baseURL !== undefined) patch.baseURL = baseURL
  if (modelName !== undefined) patch.model = modelName
  if (protocol === 'openai-chat-completions' || protocol === 'openai-responses') patch.protocol = protocol
  if (authType === 'none') {
    patch.auth = { type: 'none' }
    delete patch.apiKeyEnv
  } else if (authType === 'api-key' || apiKeyEnv !== undefined) {
    patch.auth = undefined
    patch.apiKeyEnv = apiKeyEnv ?? patch.apiKeyEnv
  }
  return removeUndefinedFields(patch) as ProviderConfig
}

function fallbackProviderCapabilities(providerId: string): Record<string, boolean | number> {
  switch (providerId) {
    case 'openai':
    case 'openai-codex':
      return { tools: true, vision: true, streaming: false, reasoning: true, contextWindowTokens: 128000 }
    case 'deepseek':
      return { tools: true, vision: false, streaming: false, reasoning: true, contextWindowTokens: 128000 }
    case 'minimax-cn':
      return { tools: true, vision: false, streaming: false, reasoning: true, contextWindowTokens: 100000 }
    default:
      return { tools: true, vision: false, streaming: false, reasoning: false, contextWindowTokens: 32000 }
  }
}

function isBuiltinProviderId(providerId: string): boolean {
  return Object.values(builtinProviders).some(provider => provider.id === providerId)
}

function normalizeDisplayEnvKeys(provider: ProviderConfig | undefined): string[] {
  const raw = provider?.apiKeyEnv ?? (provider?.auth?.type === 'api-key' || provider?.auth?.type === 'codex-access-token'
    ? provider.auth.envKeys
    : undefined)
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  return typeof raw === 'string' ? [raw] : []
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildPermissionSettingsPatch(body: Record<string, unknown>, existing: PermissionConfig | undefined): PermissionConfig {
  const approvalPolicy = parseApprovalPolicy(body.approvalPolicy, existing?.approvalPolicy ?? 'on-request')
  const sandboxMode = parseSandboxMode(body.sandboxMode, existing?.sandboxMode ?? 'workspace-write')
  const approvalsReviewer = parseApprovalsReviewer(body.approvalsReviewer, existing?.approvalsReviewer)
  const trustedTools = body.trustedTools === undefined
    ? existing?.trustedTools
    : stringListBody(body.trustedTools)

  return removeUndefinedFields({
    ...(existing ?? {}),
    approvalPolicy,
    sandboxMode,
    approvalsReviewer,
    trustedTools,
  }) as PermissionConfig
}

function buildGatewaySettingsPatch(body: Record<string, unknown>): NonNullable<ProjectConfig['gateway']> {
  const patch: NonNullable<ProjectConfig['gateway']> = {}
  if (body.gatewayEnabled !== undefined || body.enabled !== undefined) {
    patch.enabled = parseOptionalBooleanBody(body.gatewayEnabled ?? body.enabled, 'gatewayEnabled')
  }
  const heartbeatIntervalMs = optionalPositiveIntegerBody(body.heartbeatIntervalMs)
  if (heartbeatIntervalMs !== undefined) patch.heartbeatIntervalMs = heartbeatIntervalMs
  const progressHeartbeatIntervalMs = optionalPositiveIntegerBody(body.progressHeartbeatIntervalMs)
  if (progressHeartbeatIntervalMs !== undefined) patch.progressHeartbeatIntervalMs = progressHeartbeatIntervalMs
  const wakeHeartbeatIntervalMs = optionalPositiveIntegerBody(body.wakeHeartbeatIntervalMs)
  if (wakeHeartbeatIntervalMs !== undefined) patch.wakeHeartbeatIntervalMs = wakeHeartbeatIntervalMs
  if (body.allowUsers !== undefined) patch.allowUsers = stringListBody(body.allowUsers)
  if (body.pairingSecretEnv !== undefined) patch.pairingSecretEnv = optionalTrimmedString(body.pairingSecretEnv)
  return patch
}

function parseApprovalPolicy(value: unknown, fallback: ApprovalPolicy): ApprovalPolicy {
  if (value === undefined || value === null || value === '') return fallback
  if (
    value === 'unless-trusted' ||
    value === 'on-failure' ||
    value === 'on-request' ||
    value === 'granular' ||
    value === 'never'
  ) return value
  throw new Error('approvalPolicy must be one of: unless-trusted, on-failure, on-request, granular, never')
}

function parseSandboxMode(value: unknown, fallback: SandboxMode): SandboxMode {
  if (value === undefined || value === null || value === '') return fallback
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value
  throw new Error('sandboxMode must be one of: read-only, workspace-write, danger-full-access')
}

function parseApprovalsReviewer(value: unknown, fallback: ApprovalsReviewer | undefined): ApprovalsReviewer | undefined {
  if (value === undefined || value === null || value === '') return fallback
  if (value === 'user' || value === 'auto_review') return value
  throw new Error('approvalsReviewer must be one of: user, auto_review')
}

function parseOptionalBooleanBody(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value
  throw new Error(`${name} must be a boolean`)
}

function cloneConfig(config: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(config)) as ProjectConfig
}

function removeUndefinedFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

async function handleLoopCreateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (!objective) {
    sendJson(response, 400, { ok: false, error: 'objective must be a non-empty string' })
    return
  }
  let workspaceIsolation: LoopWorkspaceIsolation | undefined
  try {
    workspaceIsolation = parseLoopWorkspaceIsolationBody(body.workspaceIsolation)
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
    return
  }

  const spec: LoopSpec = {
    loopId: typeof body.loopId === 'string' && body.loopId.trim() ? body.loopId.trim() : undefined,
    goalId: typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
    objective,
    successCriteria: typeof body.successCriteria === 'string' && body.successCriteria.trim() ? body.successCriteria.trim() : undefined,
    trigger: parseLoopTriggerBody(body.trigger),
    cwd: runtime.cwd,
    workspaceIsolation,
    verification: buildLoopVerification(body),
    failurePolicy: {
      maxIterations: positiveIntegerBody(body.maxIterations, 3),
      maxConsecutiveFailures: positiveIntegerBody(body.maxConsecutiveFailures, 3),
      maxRuntimeMs: positiveIntegerBody(body.maxRuntimeMs, 300_000),
      maxTokens: positiveIntegerBody(body.maxTokens, 100_000),
      manualIntervention: buildManualInterventionPolicy(body),
    },
  }
  const store = new LocalLoopStore(runtime.cwd)
  const metadata = await store.createLoop(spec, {
    sessionId: `web-loop-${Date.now()}`,
    cwd: runtime.cwd,
  })
  sendJson(response, 200, { ok: true, metadata, summary: await store.readSummary(metadata.loopId) })
}

async function handleLoopActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  loopId: string,
  action: string,
): Promise<void> {
  const body: Record<string, unknown> = action === 'run' || action === 'resume' ? await readJsonBody(request) : {}
  const store = new LocalLoopStore(runtime.cwd)
  if (action === 'pause' || action === 'stop') {
    const metadata = await store.updateStatus(loopId, action === 'pause' ? 'paused' : 'stopped', `Loop ${action} requested from Web GUI.`)
    sendJson(response, 200, { ok: true, metadata, summary: await store.readSummary(loopId) })
    return
  }

  const loopRuntime = new LoopRuntime(store)
  const sessionId = `web-loop-${Date.now()}`
  const output = await loopRuntime.runLoop(loopId, {
    sessionId,
    config: runtime.config,
    registry: runtime.registry,
    fetch: runtime.fetch,
    maxToolRounds: 4,
    resume: action === 'resume',
    goalId: typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined,
    requestToolApproval: requestWebApproval(runtime, loopId),
    onEvent: event => runtime.broker.publishGlobal(event),
    metadata: {
      guiBackend: createGuiBackendFromMcpConnections(runtime.mcpConnections),
    },
  })
  sendJson(response, 200, { ok: true, output, summary: await store.readSummary(loopId) })
}

async function handleGatewayV2StartRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const gateway = createGatewayV2ForServer(runtime)
  sendJson(response, 200, { ok: true, started: true, status: await gateway.start() })
}

async function handleGatewayV2StopRequest(response: ServerResponse, runtime: ServerRuntime): Promise<void> {
  const gateway = createGatewayV2ForServer(runtime)
  sendJson(response, 200, { ok: true, stopped: true, status: await gateway.stop('Gateway stop requested from server API.') })
}

async function handleGatewayV2InboundRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const channelId = typeof body.channelId === 'string' && body.channelId.trim() ? body.channelId.trim() : 'local'
  if (!/^[A-Za-z0-9_-]+$/.test(channelId)) {
    sendJson(response, 400, { ok: false, error: 'channelId must be an ASCII channel id' })
    return
  }
  const channel = runtime.config.gateway?.channels?.[channelId]
  if (!isGatewayInboundSecretAccepted(request, body, channel)) {
    sendJson(response, 403, { ok: false, error: `gateway inbound secret is not accepted for channel ${channelId}` })
    return
  }
  const inbound = parseGatewayInboundMessage(channelId, channel, body)
  if (!inbound.text) {
    sendJson(response, 400, { ok: false, error: 'gateway inbound text must be provided' })
    return
  }
  const gateway = createGatewayV2ForServer(runtime)
  const received = await gateway.receiveInbound({
    channelId,
    channelKind: inferGatewayChannelKind(channelId),
    externalMessageId: typeof body.externalMessageId === 'string' ? body.externalMessageId : undefined,
    userId: inbound.userId,
    text: inbound.text,
    rawRef: typeof body.rawRef === 'string' ? { summary: body.rawRef } : undefined,
  })
  const dispatch = received.denied || received.duplicate ? undefined : await gateway.dispatchNextInbound()
  const delivery = await gateway.sendNextOutbound()
  sendJson(response, 200, {
    ok: true,
    inboundId: received.envelope.inboundId,
    duplicate: received.duplicate,
    denied: received.denied,
    commandId: dispatch?.commandId,
    deliveryId: delivery?.deliveryId,
    status: dispatch?.ok === false ? 'failed' : received.duplicate ? 'deduped' : received.denied ? 'denied' : 'queued',
  })
}
async function handleGatewayV2StatusRequest(response: ServerResponse, runtime: ServerRuntime): Promise<void> {
  const gateway = createGatewayV2ForServer(runtime)
  sendJson(response, 200, {
    ok: true,
    status: await gateway.status(),
    pendingApprovals: await gateway.listPendingApprovals(),
  })
}

async function handleGatewayV2TickRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const gateway = createGatewayV2ForServer(runtime)
  const output = await gateway.tick({
    maxInbound: positiveIntegerBody(body.maxInbound, 5),
    maxOutbound: positiveIntegerBody(body.maxOutbound, 5),
  })
  sendJson(response, 200, { ok: true, output })
}

async function handleGatewayV2ApprovalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  decision: 'approve' | 'deny',
): Promise<void> {
  const body = await readJsonBody(request)
  const approvalId = typeof body.approvalId === 'string' && body.approvalId.trim()
    ? body.approvalId.trim()
    : typeof body.id === 'string' && body.id.trim()
      ? body.id.trim()
      : ''
  if (!approvalId) {
    sendJson(response, 400, { ok: false, error: 'approvalId must be provided' })
    return
  }
  const gateway = createGatewayV2ForServer(runtime)
  const result = await gateway.approvalBridge.resolveApproval(approvalId, decision, 'server')
  sendJson(response, result.ok ? 200 : 404, { ok: result.ok, result })
}

function createGatewayV2ForServer(runtime: ServerRuntime): GatewayDaemon {
  return new GatewayDaemon({
    workspaceRoot: runtime.cwd,
    workspaceId: 'default',
    source: 'server',
  })
}
async function handleGatewayStatusRequest(response: ServerResponse, runtime: ServerRuntime): Promise<void> {
  const store = new LocalGatewayStore(runtime.cwd)
  const gateway = new GatewayRuntime(store, new LocalLoopStore(runtime.cwd), runtime.approvalStore)
  const threadStore = new LocalThreadStore(runtime.cwd)
  const doctor = await gateway.doctor(runtime.config)
  sendJson(response, 200, {
    ok: doctor.ok,
    doctor,
    worker: gatewayWorkerSnapshot(runtime.gatewayWorker),
    state: await store.readState(),
    inbox: (await store.readInbound()).slice(-20),
    outbox: (await store.readOutbound()).slice(-20),
    pairedUsers: await store.readPairedUsers(),
    events: (await store.readEvents()).slice(-50),
    wakeRuns: (await store.readWakeRuns()).slice(-20),
    recentToolFailures: await gateway.readRecentToolFailures(5),
    recentRuns: await threadStore.readRunLedger({ limit: 10 }),
    recentStaleRuns: await threadStore.readStaleRuns({ limit: 10 }),
    pendingApprovals: await runtime.approvalStore.readPending(),
  })
}

async function handleGatewayStartRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const existing = runtime.gatewayWorker
  if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
    sendJson(response, 200, {
      ok: true,
      alreadyRunning: true,
      worker: gatewayWorkerSnapshot(existing),
      state: await new LocalGatewayStore(runtime.cwd).readState(),
    })
    return
  }

  const { store, worker } = startGatewayWorker(runtime, body, 'web-gateway-worker', false)

  await waitMs(25)
  sendJson(response, 200, {
    ok: true,
    started: true,
    worker: gatewayWorkerSnapshot(worker),
    state: await store.readState(),
  })
}

async function handleGatewayRecoverRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const existing = runtime.gatewayWorker
  if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
    sendJson(response, 200, {
      ok: true,
      recovered: false,
      alreadyRunning: true,
      worker: gatewayWorkerSnapshot(existing),
      state: await new LocalGatewayStore(runtime.cwd).readState(),
    })
    return
  }

  const store = new LocalGatewayStore(runtime.cwd)
  const gateway = new GatewayRuntime(store, new LocalLoopStore(runtime.cwd), runtime.approvalStore)
  const doctor = await gateway.doctor(runtime.config)
  if (!doctor.watchdog.recoverable) {
    sendJson(response, 200, {
      ok: true,
      recovered: false,
      watchdog: doctor.watchdog,
      worker: gatewayWorkerSnapshot(runtime.gatewayWorker),
      state: await store.readState(),
      message: `Gateway recovery is not required for watchdog status ${doctor.watchdog.status}.`,
    })
    return
  }

  const started = startGatewayWorker(runtime, body, 'web-gateway-recover', true)
  await waitMs(25)
  sendJson(response, 200, {
    ok: true,
    recovered: true,
    previousWatchdog: doctor.watchdog,
    worker: gatewayWorkerSnapshot(started.worker),
    state: await started.store.readState(),
  })
}

async function handleGatewayStopRequest(response: ServerResponse, runtime: ServerRuntime): Promise<void> {
  const worker = runtime.gatewayWorker
  if (!worker || (worker.status !== 'running' && worker.status !== 'stopping')) {
    sendJson(response, 200, {
      ok: true,
      stopped: false,
      worker: gatewayWorkerSnapshot(worker),
      state: await new LocalGatewayStore(runtime.cwd).readState(),
      message: 'No active Web Gateway worker is running.',
    })
    return
  }

  await stopGatewayWorker(runtime, 1000)
  sendJson(response, 200, {
    ok: true,
    stopped: isGatewayWorkerSettled(worker),
    worker: gatewayWorkerSnapshot(worker),
    state: await new LocalGatewayStore(runtime.cwd).readState(),
  })
}

async function handleGatewayMessageRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    sendJson(response, 400, { ok: false, error: 'text must be a non-empty gateway command' })
    return
  }
  const channelId = typeof body.channelId === 'string' && body.channelId.trim() ? body.channelId.trim() : 'local'
  if (!/^[A-Za-z0-9_-]+$/.test(channelId)) {
    sendJson(response, 400, { ok: false, error: 'channelId must be an ASCII channel id' })
    return
  }
  const store = new LocalGatewayStore(runtime.cwd)
  if (runtime.gatewayWorker?.status === 'running') {
    const message = await enqueueGatewayMessage(runtime, {
      channelId,
      userId: typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : 'local-user',
      text,
    })
    sendJson(response, 200, {
      ok: true,
      queued: true,
      message,
      worker: gatewayWorkerSnapshot(runtime.gatewayWorker),
      state: await store.readState(),
      outbox: (await store.readOutbound()).slice(-20),
    })
    return
  }

  const gateway = new GatewayRuntime(store, new LocalLoopStore(runtime.cwd), runtime.approvalStore)
  const output = await gateway.start({
    sessionId: `web-gateway-${Date.now()}`,
    config: runtime.config,
    durationMs: positiveIntegerBody(body.durationMs, 250),
    heartbeatIntervalMs: positiveIntegerBody(body.heartbeatIntervalMs, runtime.config.gateway?.heartbeatIntervalMs ?? 100),
    wakeHeartbeatIntervalMs: positiveIntegerBody(body.wakeHeartbeatIntervalMs, runtime.config.gateway?.wakeHeartbeatIntervalMs ?? 300_000),
    tickIntervalMs: 25,
    fetch: runtime.fetch,
    localMessages: [
      {
        channelId,
        userId: typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : 'local-user',
        text,
      },
    ],
  })
  sendJson(response, 200, {
    ok: true,
    output,
    state: output.state,
    outbox: (await store.readOutbound()).slice(-20),
  })
}

async function handleGatewayInboundRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const channelId = typeof body.channelId === 'string' && body.channelId.trim() ? body.channelId.trim() : 'local'
  if (!/^[A-Za-z0-9_-]+$/.test(channelId)) {
    sendJson(response, 400, { ok: false, error: 'channelId must be an ASCII channel id' })
    return
  }

  const channel = runtime.config.gateway?.channels?.[channelId]
  if (!isGatewayInboundSecretAccepted(request, body, channel)) {
    sendJson(response, 403, { ok: false, error: `gateway inbound secret is not accepted for channel ${channelId}` })
    return
  }

  const inbound = parseGatewayInboundMessage(channelId, channel, body)
  if (!inbound.text) {
    sendJson(response, 400, { ok: false, error: 'gateway inbound text must be provided' })
    return
  }

  const store = new LocalGatewayStore(runtime.cwd)
  if (runtime.gatewayWorker?.status === 'running') {
    const message = await enqueueGatewayMessage(runtime, {
      channelId,
      userId: inbound.userId,
      text: inbound.text,
    })
    sendJson(response, 200, {
      ok: true,
      queued: true,
      message,
      worker: gatewayWorkerSnapshot(runtime.gatewayWorker),
      state: await store.readState(),
      outbox: (await store.readOutbound()).slice(-20),
    })
    return
  }

  const gateway = new GatewayRuntime(store, new LocalLoopStore(runtime.cwd), runtime.approvalStore)
  const output = await gateway.start({
    sessionId: `web-gateway-inbound-${Date.now()}`,
    config: runtime.config,
    durationMs: positiveIntegerBody(body.durationMs, 250),
    heartbeatIntervalMs: positiveIntegerBody(body.heartbeatIntervalMs, runtime.config.gateway?.heartbeatIntervalMs ?? 100),
    wakeHeartbeatIntervalMs: positiveIntegerBody(body.wakeHeartbeatIntervalMs, runtime.config.gateway?.wakeHeartbeatIntervalMs ?? 300_000),
    tickIntervalMs: 25,
    fetch: runtime.fetch,
    localMessages: [
      {
        channelId,
        userId: inbound.userId,
        text: inbound.text,
      },
    ],
  })
  sendJson(response, 200, {
    ok: true,
    output,
    state: output.state,
    outbox: (await store.readOutbound()).slice(-20),
  })
}

async function enqueueGatewayMessage(
  runtime: ServerRuntime,
  input: { channelId: string; userId: string; text: string },
): Promise<unknown> {
  const store = new LocalGatewayStore(runtime.cwd)
  const channel = runtime.config.gateway?.channels?.[input.channelId]
  return store.appendInbound({
    channelId: input.channelId,
    channelKind: gatewayChannelKind(input.channelId, channel),
    userId: input.userId,
    text: input.text,
  })
}

function startGatewayWorker(
  runtime: ServerRuntime,
  body: Record<string, unknown>,
  sessionPrefix: string,
  wakeOnStart: boolean,
): { store: LocalGatewayStore; worker: ActiveGatewayWorker } {
  const store = new LocalGatewayStore(runtime.cwd)
  const gateway = new GatewayRuntime(store, new LocalLoopStore(runtime.cwd), runtime.approvalStore)
  const worker: ActiveGatewayWorker = {
    sessionId: `${sessionPrefix}-${Date.now()}`,
    startedAtMs: Date.now(),
    status: 'running',
    gateway,
    promise: Promise.resolve(undefined),
  }
  runtime.gatewayWorker = worker
  worker.promise = gateway.start({
    sessionId: worker.sessionId,
    config: runtime.config,
    heartbeatIntervalMs: positiveIntegerBody(body.heartbeatIntervalMs, runtime.config.gateway?.heartbeatIntervalMs ?? 60_000),
    progressHeartbeatIntervalMs: positiveIntegerBody(body.progressHeartbeatIntervalMs, runtime.config.gateway?.progressHeartbeatIntervalMs ?? runtime.config.gateway?.heartbeatIntervalMs ?? 60_000),
    wakeHeartbeatIntervalMs: positiveIntegerBody(body.wakeHeartbeatIntervalMs, runtime.config.gateway?.wakeHeartbeatIntervalMs ?? 300_000),
    wakeOnStart,
    tickIntervalMs: positiveIntegerBody(body.tickIntervalMs, 250),
    fetch: runtime.fetch,
  }).then(output => {
    worker.status = 'stopped'
    return output
  }).catch(async error => {
    worker.status = 'failed'
    worker.lastError = errorMessage(error)
    try {
      await store.appendEvent({
        type: 'gateway_worker_failed',
        message: worker.lastError,
        data: {
          sessionId: worker.sessionId,
        },
      })
    } catch {
      // Preserve the original worker failure; status polling will expose lastError.
    }
    return undefined
  })
  return { store, worker }
}

async function stopGatewayWorker(runtime: ServerRuntime, timeoutMs: number): Promise<void> {
  const worker = runtime.gatewayWorker
  if (!worker || (worker.status !== 'running' && worker.status !== 'stopping')) return
  worker.status = 'stopping'
  worker.gateway.stop()
  await Promise.race([
    worker.promise,
    waitMs(timeoutMs),
  ])
}

function gatewayWorkerSnapshot(worker: ActiveGatewayWorker | undefined): Record<string, unknown> {
  if (!worker) {
    return {
      running: false,
      status: 'stopped',
    }
  }
  return {
    running: worker.status === 'running',
    sessionId: worker.sessionId,
    startedAtMs: worker.startedAtMs,
    status: worker.status,
    lastError: worker.lastError,
  }
}

function isGatewayWorkerSettled(worker: ActiveGatewayWorker): boolean {
  return worker.status === 'stopped' || worker.status === 'failed'
}

function gatewayChannelKind(channelId: string, channel: GatewayChannelConfig | undefined): GatewayChannelKind {
  if (channel) return channel.kind
  return channelId === 'mock' ? 'mock' : 'local'
}

async function handleFilesRequest(response: ServerResponse, runtime: ServerRuntime, url: URL): Promise<void> {
  const requestedPath = url.searchParams.get('path') ?? ''
  const target = resolve(runtime.cwd, requestedPath)
  if (!isInside(runtime.cwd, target)) {
    sendJson(response, 403, { ok: false, error: 'path must stay inside the current workspace' })
    return
  }

  const targetStat = await stat(target)
  if (!targetStat.isDirectory()) {
    sendJson(response, 400, { ok: false, error: 'path must point to a directory' })
    return
  }

  const names = (await readdir(target)).filter(name => !shouldHideFileEntry(name))
  const entries = await Promise.all(names.map(async name => {
    const absolutePath = resolve(target, name)
    const entryStat = await stat(absolutePath)
    return {
      name,
      absolutePath,
      isDirectory: entryStat.isDirectory(),
      size: entryStat.size,
    }
  }))
  const visibleEntries = entries
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    .slice(0, 250)

  const files = visibleEntries.map(entry => {
    const relativePath = toWorkspaceRelativePath(runtime.cwd, entry.absolutePath)
    return {
      name: entry.name,
      path: relativePath,
      relativePath,
      kind: entry.isDirectory ? 'directory' : 'file',
      size: entry.isDirectory ? undefined : entry.size,
    }
  })

  sendJson(response, 200, {
    ok: true,
    cwd: runtime.cwd,
    path: toWorkspaceRelativePath(runtime.cwd, target),
    parentPath: target === resolve(runtime.cwd) ? undefined : toWorkspaceRelativePath(runtime.cwd, resolve(target, '..')),
    truncated: entries.length > visibleEntries.length,
    entries: files,
  })
}

async function handleStopRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) {
    sendJson(response, 400, { ok: false, error: 'threadId must be an ASCII thread id' })
    return
  }

  const run = runtime.activeRuns.get(threadId)
  if (!run) {
    sendJson(response, 200, { ok: true, stopped: false, message: 'No active run for this thread.' })
    return
  }

  run.abort()
  runtime.broker.publish(threadId, {
    type: 'run_stop_requested',
    threadId,
    message: 'Stop requested from Web GUI.',
    createdAtMs: Date.now(),
  })
  sendJson(response, 200, { ok: true, stopped: true })
}

async function handleChatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
): Promise<void> {
  const body = await readJsonBody(request)
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    sendJson(response, 400, { ok: false, error: 'prompt must be a non-empty string' })
    return
  }

  const store = new LocalThreadStore(runtime.cwd)
  const sessionId = `web-${Date.now()}`
  const threadId = await resolveChatThreadId(body, store, runtime, sessionId, prompt)
  const goalId = typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined
  const goalStore = goalId ? new LocalGoalStore(runtime.cwd) : undefined
  if (goalId && goalStore) {
    await goalStore.readSummary(goalId)
    const metadata = await store.readMetadata(threadId)
    if (metadata.goalId !== goalId) {
      await store.writeMetadata({ ...metadata, goalId, updatedAtMs: Date.now() })
    }
    await goalStore.appendRun(goalId, {
      runId: sessionId,
      kind: 'thread',
      status: 'started',
      startedAtMs: Date.now(),
      threadId,
      summary: 'Web chat run started.',
    })
  }
  if (runtime.activeRuns.has(threadId)) {
    sendJson(response, 409, { ok: false, error: `Thread already has an active run: ${threadId}` })
    return
  }

  const engine = new AgentKernel({
    cwd: runtime.cwd,
    sessionId,
    commandSource: 'web',
    config: runtime.config,
    registry: runtime.registry,
    threadId,
    goalId,
    fetch: runtime.fetch,
    requestToolApproval: requestWebApproval(runtime, threadId),
    onEvent: createWebEventHandler(runtime.broker, threadId),
    metadata: {
      guiBackend: createGuiBackendFromMcpConnections(runtime.mcpConnections),
    },
  })

  runtime.activeRuns.set(threadId, {
    threadId,
    abort: () => engine.abort('server run aborted'),
  })

  try {
    await maybeRenameFreshThread(store, threadId, prompt)
    const result = await engine.submitMessage(prompt)
    if (goalId && goalStore) {
      await goalStore.appendRun(goalId, {
        runId: sessionId,
        kind: 'thread',
        status: 'completed',
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
        threadId,
        summary: 'Web chat run completed.',
      })
      await goalStore.appendEvidence(goalId, {
        type: 'thread',
        strength: 'indirect',
        summary: previewText(result.finalText, 300),
        threadId,
      })
    }
    sendJson(response, 200, {
      ok: true,
      threadId,
      finalText: result.finalText,
      toolResults: result.toolResults,
      events: engine.events(),
    })
  } catch (error) {
    if (goalId && goalStore) {
      await goalStore.appendRun(goalId, {
        runId: sessionId,
        kind: 'thread',
        status: 'failed',
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
        threadId,
        summary: errorMessage(error),
      })
    }
    sendJson(response, 500, {
      ok: false,
      threadId,
      error: errorMessage(error),
      events: engine.events(),
    })
  } finally {
    runtime.activeRuns.delete(threadId)
  }
}

async function maybeRenameFreshThread(store: LocalThreadStore, threadId: string, prompt: string): Promise<void> {
  const summary = await store.readThreadSummary(threadId)
  if (summary.messageCount > 0) return
  const title = summary.metadata.title.trim()
  if (title && title !== 'New Pando thread' && !title.startsWith('thread_')) return
  const nextTitle = previewText(prompt, 80).replace(/\s+/g, ' ').trim()
  if (nextTitle) await store.renameThread(threadId, nextTitle)
}

async function resolveChatThreadId(
  body: Record<string, unknown>,
  store: LocalThreadStore,
  runtime: ServerRuntime,
  sessionId: string,
  prompt: string,
): Promise<string> {
  if (typeof body.threadId === 'string' && body.threadId.trim()) return body.threadId.trim()
  const record = await store.createThread({
    sessionId,
    cwd: runtime.cwd,
    title: previewText(prompt, 80).replace(/\s+/g, ' '),
    model: modelMetadata(resolveModel(runtime.config)),
    permissions: runtime.config.permissions,
    goalId: typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : undefined,
  })
  return record.metadata.threadId
}

function requestWebApproval(runtime: ServerRuntime, threadId: string) {
  return (request: ToolApprovalRequest): Promise<ToolApprovalDecision> => {
    const approvedTools = runtime.alwaysApprovedTools.get(threadId)
    if (approvedTools?.has(request.toolName)) {
      return Promise.resolve({
        approved: true,
        reason: `Tool ${request.toolName} was approved for this thread.`,
      })
    }

    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    return new Promise(resolveApproval => {
      const pending: PendingApproval = {
        approvalId,
        threadId,
        request,
        resolve: resolveApproval,
      }
      runtime.pendingApprovals.set(approvalId, pending)
      void runtime.approvalStore.createPending({
        approvalId,
        threadId,
        request,
      }).then(record => {
        runtime.broker.publish(threadId, {
          type: 'approval_pending',
          approvalId,
          threadId,
          request: record.request,
          createdAtMs: record.createdAtMs,
        })
        return runtime.approvalStore.waitForResolution(approvalId)
      }).then(record => {
        const current = runtime.pendingApprovals.get(approvalId)
        if (!current) return
        return completePendingApproval(
          runtime,
          current,
          record.decision ?? (record.status === 'approved' ? 'approve_once' : 'reject'),
          record.resolvedBy ?? 'approval_store',
        )
      }).catch(error => {
        const current = runtime.pendingApprovals.get(approvalId)
        if (!current) return
        runtime.pendingApprovals.delete(approvalId)
        const reason = `Approval store failed: ${errorMessage(error)}`
        current.resolve({ approved: false, reason })
        runtime.broker.publish(current.threadId, {
          type: 'approval_answered',
          approvalId,
          threadId: current.threadId,
          approved: false,
          decision: 'reject',
          reason,
          createdAtMs: Date.now(),
        })
      })
    })
  }
}

async function handleApprovalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  approvalId: string,
): Promise<void> {
  const pending = runtime.pendingApprovals.get(approvalId)
  const body = await readJsonBody(request)
  const decision = String(body.decision ?? '')
  if (!['approve_once', 'approve_always', 'reject'].includes(decision)) {
    sendJson(response, 400, { ok: false, error: 'decision must be approve_once, approve_always, or reject' })
    return
  }

  if (!pending) {
    const record = await runtime.approvalStore.resolveApproval(approvalId, {
      decision: decision as StoredApprovalDecision,
      resolvedBy: 'web_api',
    })
    if (!record) {
      sendJson(response, 404, { ok: false, error: `Unknown approval id: ${approvalId}` })
      return
    }
    sendJson(response, 200, { ok: true, approvalId, approved: record.status === 'approved' })
    return
  }

  const result = await completePendingApproval(runtime, pending, decision as StoredApprovalDecision, 'web_api')
  sendJson(response, 200, { ok: true, approvalId, approved: result.approved })
}

async function completePendingApproval(
  runtime: ServerRuntime,
  pending: PendingApproval,
  decision: StoredApprovalDecision,
  resolvedBy: string,
): Promise<{ approved: boolean; reason: string }> {
  runtime.pendingApprovals.delete(pending.approvalId)
  const record = await runtime.approvalStore.resolveApproval(pending.approvalId, {
    decision,
    resolvedBy,
  })
  const result = record
    ? storedApprovalToDecision(record)
    : {
        approved: false,
        reason: `Unknown approval id: ${pending.approvalId}`,
      }
  if (decision === 'approve_always' && result.approved) {
    const current = runtime.alwaysApprovedTools.get(pending.threadId) ?? new Set<string>()
    current.add(pending.request.toolName)
    runtime.alwaysApprovedTools.set(pending.threadId, current)
  }
  pending.resolve(result)
  runtime.broker.publish(pending.threadId, {
    type: 'approval_answered',
    approvalId: pending.approvalId,
    threadId: pending.threadId,
    approved: result.approved,
    decision,
    reason: result.reason,
    createdAtMs: Date.now(),
  })
  return result
}

async function handleThreadModelRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  threadId: string,
): Promise<void> {
  const body = await readJsonBody(request)
  const providerId = typeof body.provider === 'string' ? body.provider.trim() : ''
  if (!/^[A-Za-z0-9_-]+$/.test(providerId)) {
    sendJson(response, 400, { ok: false, error: 'provider must be an ASCII provider id' })
    return
  }

  const modelName = optionalTrimmedString(body.modelName ?? body.model)
  let model
  try {
    model = resolveDefaultModel({
      ...runtime.config,
      model: {
        ...(runtime.config.model ?? {}),
        provider: providerId,
        name: modelName,
      },
    })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: errorMessage(error) })
    return
  }

  const store = new LocalThreadStore(runtime.cwd)
  try {
    const metadata = await store.readMetadata(threadId)
    const nextMetadata = {
      ...metadata,
      model: modelMetadata(model),
      updatedAtMs: Date.now(),
    }
    await store.writeMetadata(nextMetadata)
    sendJson(response, 200, {
      ok: true,
      metadata: nextMetadata,
      model: nextMetadata.model,
    })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleThreadRenameRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  threadId: string,
): Promise<void> {
  const body = await readJsonBody(request)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) {
    sendJson(response, 400, { ok: false, error: 'title must be a non-empty string' })
    return
  }
  const store = new LocalThreadStore(runtime.cwd)
  try {
    const metadata = await store.renameThread(threadId, title)
    sendJson(response, 200, {
      ok: true,
      metadata,
      summary: await store.readThreadSummary(threadId),
    })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleThreadBranchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  threadId: string,
): Promise<void> {
  const body = await readJsonBody(request)
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined
  const store = new LocalThreadStore(runtime.cwd)
  try {
    const record = await store.branchThread(threadId, {
      sessionId: `web-branch-${Date.now()}`,
      title,
    })
    sendJson(response, 200, {
      ok: true,
      metadata: record.metadata,
      summary: await store.readThreadSummary(record.metadata.threadId),
    })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleThreadExportRequest(
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
  threadId: string,
): Promise<void> {
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'md'
  const store = new LocalThreadStore(runtime.cwd)
  try {
    sendJson(response, 200, {
      ok: true,
      threadId,
      format,
      content: await store.exportThread(threadId, format),
    })
  } catch (error) {
    sendJson(response, 404, { ok: false, error: errorMessage(error) })
  }
}

async function handleEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ServerRuntime,
  url: URL,
): Promise<void> {
  const threadId = url.searchParams.get('threadId')
  if (!threadId || !/^[A-Za-z0-9_-]+$/.test(threadId)) {
    sendJson(response, 400, { ok: false, error: 'threadId query parameter is required' })
    return
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  response.write(': connected\n\n')

  const store = new LocalThreadStore(runtime.cwd)
  for (const event of await store.readEvents(threadId)) {
    writeSse(response, 'agent_event', event)
  }
  const unsubscribe = runtime.broker.subscribe(threadId, payload => {
    writeSse(response, payload.type === 'agent_event' ? 'agent_event' : payload.type, payload.data)
  })

  const keepalive = setInterval(() => response.write(': keepalive\n\n'), 15_000)
  let maxLifetime: ReturnType<typeof setTimeout>
  const close = () => {
    clearInterval(keepalive)
    clearTimeout(maxLifetime)
    unsubscribe()
  }
  request.on('close', close)
  maxLifetime = setTimeout(close, 60 * 60 * 1000)
}

function createWebEventHandler(broker: EventBroker, fallbackThreadId: string): AgentEventHandler {
  return event => {
    const threadId = eventThreadId(event) ?? fallbackThreadId
    broker.publish(threadId, event)
  }
}

function eventThreadId(event: AgentEvent): string | undefined {
  return 'threadId' in event && typeof event.threadId === 'string' ? event.threadId : undefined
}

function resolveModel(config: ProjectConfig) {
  return resolveDefaultModel(config)
}

class EventBroker {
  private readonly subscribers = new Map<string, Set<(payload: { type: string; data: unknown }) => void>>()

  subscribe(threadId: string, listener: (payload: { type: string; data: unknown }) => void): () => void {
    const listeners = this.subscribers.get(threadId) ?? new Set()
    listeners.add(listener)
    this.subscribers.set(threadId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.subscribers.delete(threadId)
    }
  }

  publish(threadId: string, data: unknown): void {
    const type = isRecord(data) && typeof data.type === 'string' && isAgentEventType(data.type)
      ? 'agent_event'
      : isRecord(data) && typeof data.type === 'string'
        ? data.type
        : 'event'
    for (const listener of this.subscribers.get(threadId) ?? []) {
      listener({ type, data })
    }
  }

  publishGlobal(data: unknown): void {
    for (const listeners of this.subscribers.values()) {
      for (const listener of listeners) listener({ type: 'agent_event', data })
    }
  }
}

function isAgentEventType(type: string): boolean {
  return !type.startsWith('approval_') || type === 'approval_requested' || type === 'approval_completed'
}

async function serveStatic(response: ServerResponse, staticRoot: string, pathname: string): Promise<void> {
  const safePath = decodeURIComponent(pathname.split('?')[0] ?? '/')
  const relativePath = safePath === '/' ? 'index.html' : safePath.replace(/^\/+/, '')
  const target = resolve(staticRoot, relativePath)
  if (!isInside(staticRoot, target)) {
    sendText(response, 403, 'Forbidden')
    return
  }

  try {
    const content = await readFile(target, extname(target) ? undefinedEncoding(extname(target)) : 'utf8')
    sendBuffer(response, 200, content, contentType(target))
  } catch {
    try {
      const index = await readFile(join(staticRoot, 'index.html'), 'utf8')
      sendText(response, 200, index, 'text/html; charset=utf-8')
    } catch {
      sendText(
        response,
        200,
        '<!doctype html><title>Pando</title><h1>Pando web GUI is not built</h1><p>Run npm run web:build, then start pando serve again.</p>',
        'text/html; charset=utf-8',
      )
    }
  }
}

function undefinedEncoding(_ext: string): 'utf8' {
  return 'utf8'
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.ico':
      return 'image/x-icon'
    default:
      return 'text/plain; charset=utf-8'
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(`${JSON.stringify(value, null, 2)}\n`)
}

function sendText(response: ServerResponse, status: number, text: string, type = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, { 'Content-Type': type })
  response.end(text)
}

function sendBuffer(response: ServerResponse, status: number, content: string, type: string): void {
  response.writeHead(status, { 'Content-Type': type })
  response.end(content)
}

function writeSse(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let body = ''
    request.on('data', chunk => {
      body += String(chunk)
    })
    request.on('end', () => {
      if (!body.trim()) {
        resolveBody({})
        return
      }
      try {
        const parsed = JSON.parse(body)
        resolveBody(isRecord(parsed) ? parsed : {})
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${errorMessage(error)}`))
      }
    })
    request.on('error', reject)
  })
}

function isGatewayInboundSecretAccepted(
  request: IncomingMessage,
  body: Record<string, unknown>,
  channel: GatewayChannelConfig | undefined,
): boolean {
  if (!channel || channel.kind === 'local' || channel.kind === 'mock') return true
  const envKey = channel.ingressSecretEnv
  if (!envKey) return false
  const expected = runtimeEnv(envKey)
  if (!expected) return false
  const provided = firstHeader(request.headers['x-pando-gateway-secret'])
    ?? (typeof body.secret === 'string' ? body.secret : undefined)
  return provided === expected
}

function parseGatewayInboundMessage(
  channelId: string,
  channel: GatewayChannelConfig | undefined,
  body: Record<string, unknown>,
): { userId: string; text: string } {
  const direct = parseDirectGatewayInbound(channelId, body)
  if (direct.text) return direct

  const kind = channel?.kind ?? inferGatewayChannelKind(channelId)
  switch (kind) {
    case 'telegram':
      return parseTelegramInbound(channelId, body)
    case 'feishu':
    case 'lark':
      return parseFeishuLikeInbound(channelId, body)
    case 'wecom':
      return parseWeComInbound(channelId, body)
    default:
      return direct
  }
}

function parseDirectGatewayInbound(
  channelId: string,
  body: Record<string, unknown>,
): { userId: string; text: string } {
  const directText = typeof body.text === 'string' ? body.text.trim() : ''
  const directUserId = body.userId === undefined ? undefined : String(body.userId).trim()
  if (directText) {
    return {
      userId: directUserId || `${channelId}-user`,
      text: directText,
    }
  }

  return {
    userId: directUserId || `${channelId}-user`,
    text: '',
  }
}

function parseTelegramInbound(
  channelId: string,
  body: Record<string, unknown>,
): { userId: string; text: string } {
  const message = recordValue(body.message) ?? recordValue(body.edited_message) ?? recordValue(body.channel_post)
  const text = stringValue(message?.text) || stringValue(message?.caption)
  const from = recordValue(message?.from)
  const chat = recordValue(message?.chat)
  return {
    userId: stringValue(from?.id) || stringValue(chat?.id) || `${channelId}-user`,
    text: text.trim(),
  }
}

function parseFeishuLikeInbound(
  channelId: string,
  body: Record<string, unknown>,
): { userId: string; text: string } {
  const event = recordValue(body.event)
  const message = recordValue(event?.message) ?? recordValue(body.message)
  const sender = recordValue(event?.sender) ?? recordValue(body.sender)
  const senderId = recordValue(sender?.sender_id) ?? recordValue(sender?.senderId)
  const text = textFromFeishuContent(message?.content)
    || stringValue(message?.text)
    || stringValue(event?.text)
    || stringValue(body.text)
  return {
    userId: stringValue(senderId?.open_id)
      || stringValue(senderId?.user_id)
      || stringValue(senderId?.union_id)
      || stringValue(sender?.open_id)
      || stringValue(event?.open_id)
      || `${channelId}-user`,
    text: text.trim(),
  }
}

function parseWeComInbound(
  channelId: string,
  body: Record<string, unknown>,
): { userId: string; text: string } {
  const event = recordValue(body.event) ?? body
  const textNode = recordValue(event.text)
  const text = stringValue(event.Content)
    || stringValue(event.content)
    || stringValue(textNode?.content)
    || stringValue(textNode?.Content)
    || stringValue(event.text)
  return {
    userId: stringValue(event.FromUserName)
      || stringValue(event.fromUserName)
      || stringValue(event.from_user_name)
      || stringValue(event.UserID)
      || stringValue(event.userId)
      || `${channelId}-user`,
    text: text.trim(),
  }
}

function inferGatewayChannelKind(channelId: string): GatewayChannelKind {
  if (channelId === 'telegram' || channelId === 'feishu' || channelId === 'lark' || channelId === 'wecom' || channelId === 'mock') return channelId
  return 'local'
}

function textFromFeishuContent(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (isRecord(parsed)) return stringValue(parsed.text)
  } catch {
    return trimmed
  }
  return trimmed
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function runtimeEnv(key: string): string | undefined {
  const runtime = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env?.[key]
}

function buildLoopVerification(body: Record<string, unknown>): LoopSpec['verification'] {
  const verification: Array<NonNullable<LoopSpec['verification']>[number]> = []
  if (typeof body.verifyCommand === 'string' && body.verifyCommand.trim()) {
    verification.push({
      type: 'command',
      command: body.verifyCommand.trim(),
      timeoutMs: positiveIntegerBody(body.verifyTimeoutMs, 30_000),
    })
  }
  if (typeof body.verifyFilePath === 'string' && body.verifyFilePath.trim()) {
    verification.push({
      type: 'file',
      path: body.verifyFilePath.trim(),
      exists: body.verifyFileExists === false ? false : true,
      contains: typeof body.verifyFileContains === 'string' ? body.verifyFileContains : undefined,
    })
  }
  return verification.length ? verification : undefined
}

function buildManualInterventionPolicy(body: Record<string, unknown>): NonNullable<NonNullable<LoopSpec['failurePolicy']>['manualIntervention']> | undefined {
  const afterConsecutiveFailures = optionalPositiveIntegerBody(body.manualInterventionAfterFailures)
  const afterIterations = optionalPositiveIntegerBody(body.manualInterventionAfterIterations)
  const failureTextPatterns = stringListBody(body.manualInterventionPatterns ?? body.manualInterventionPattern)
  if (afterConsecutiveFailures === undefined && afterIterations === undefined && !failureTextPatterns.length) return undefined
  return {
    afterConsecutiveFailures,
    afterIterations,
    failureTextPatterns: failureTextPatterns.length ? failureTextPatterns : undefined,
  }
}

function positiveIntegerBody(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function optionalPositiveIntegerBody(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return undefined
  return parsed
}

function stringListBody(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n|,/) : []
  return values
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function parseLoopWorkspaceIsolationBody(value: unknown): LoopWorkspaceIsolation | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'none' || value === 'temp_copy' || value === 'git_worktree') return value
  throw new Error('workspaceIsolation must be one of: none, temp_copy, git_worktree')
}

function parseLoopTriggerBody(value: unknown): LoopSpec['trigger'] {
  if (value === undefined || value === null || value === '') return 'manual'
  if (value === 'manual' || value === 'schedule' || value === 'heartbeat') return value
  throw new Error('trigger must be one of: manual, schedule, heartbeat')
}

function waitMs(ms: number): Promise<void> {
  return new Promise(resolveWait => setTimeout(resolveWait, ms))
}

function listen(server: Server, port: number, host: string): Promise<{ port: number }> {
  return new Promise((resolveListen) => {
    server.listen(port, host, () => {
      const address = server.address()
      resolveListen({ port: typeof address === 'object' && address ? address.port : port })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close(error => {
      if (error) reject(error)
      else resolveClose()
    })
  })
}

function openBrowser(url: string): void {
  const currentPlatform = platform()
  if (currentPlatform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true })
    return
  }
  if (currentPlatform === 'darwin') {
    spawn('open', [url], { windowsHide: true })
    return
  }
  spawn('xdg-open', [url], { windowsHide: true })
}

function defaultStaticRoot(): string {
  return resolve(defaultPackageRoot(), 'web', 'dist')
}

function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

function isInside(root: string, target: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}\\`) || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

function toWorkspaceRelativePath(root: string, target: string): string {
  const path = relative(resolve(root), resolve(target)).replace(/\\/g, '/')
  return path === '' ? '' : path
}

function shouldHideFileEntry(name: string): boolean {
  return name === 'node_modules' || name === 'dist' || name === '.git'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
