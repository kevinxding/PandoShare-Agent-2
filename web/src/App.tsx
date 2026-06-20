import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import './styles.css'

type ThreadMetadata = {
  threadId: string
  sessionId?: string
  title: string
  cwd: string
  createdAtMs?: number
  updatedAtMs: number
  model?: {
    provider: string
    name?: string
  }
  permissions?: {
    approvalPolicy: string
    approvalsReviewer?: string
    sandboxMode: string
    trustedTools?: string[]
  }
  parentThreadId?: string
  branchFromEventId?: string
  goalId?: string
}

type ThreadSummary = {
  metadata: ThreadMetadata
  messageCount: number
  eventCount: number
  checkpointCount: number
  compactionCount: number
  latestCompaction?: {
    compactionId: string
    windowId: number
  }
}

type ThreadData = {
  metadata: ThreadMetadata
  messages: Array<{
    role: 'user' | 'assistant' | 'tool'
    content: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  }>
  events: AgentEvent[]
  checkpoints: unknown[]
  compactions: unknown[]
}

type ThreadExportResponse = {
  ok: boolean
  error?: string
  threadId: string
  format: 'md' | 'json'
  content: string
}

type AgentEvent = {
  id?: string
  type: string
  createdAtMs?: number
  turnId?: string
  threadId?: string
  approvalId?: string
  toolName?: string
  toolUseId?: string
  serverName?: string
  action?: string
  target?: string
  promptPreview?: string
  textPreview?: string
  finalTextPreview?: string
  contentPreview?: string
  delta?: string
  message?: string
  ok?: boolean
  approved?: boolean
  decision?: string
  risk?: string
  reason?: string
  provider?: string
  model?: string
  round?: number
  toolCount?: number
  toolCalls?: Array<{ id?: string; name?: string; input?: Record<string, unknown> }>
  durationMs?: number
  input?: Record<string, unknown>
  method?: string
  fallbackUsed?: boolean
  screenshotPath?: string
  failureClass?: string
  metadata?: Record<string, unknown>
  retainedMessageCount?: number
  sourceMessageCount?: number
  droppedMessageCount?: number
  compactedMessageCount?: number
  windowId?: number
  coveredMessageCount?: number
  summaryChars?: number
  compactionSummaryIncluded?: boolean
  compactionWindowId?: number
  tokenBudget?: {
    enabled?: boolean
    estimatedTokens?: number
    estimatedTokensLeft?: number
    maxInputTokens?: number
  }
  usage?: {
    total_tokens?: number
    total_characters?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
  [key: string]: unknown
}

type PendingApproval = {
  type: 'approval_pending'
  approvalId: string
  threadId: string
  request: {
    toolName: string
    risk: string
    reason: string
    safety: string
    sandboxMode: string
    toolUse: {
      input: Record<string, unknown>
    }
  }
}

type DoctorReport = {
  ok: boolean
  model?: {
    provider: string
    name?: string
  }
  checks?: Array<{
    id: string
    status: string
    message?: string
  }>
}

type McpReport = {
  serverName: string
  status: 'connected' | 'failed'
  serverInfo?: {
    name?: string
    version?: string
  }
  toolCount: number
  tools: Array<{
    name: string
    description?: string
  }>
  error?: string
}

type GuiReport = {
  ok: boolean
  methods: {
    uia: boolean
    visual: boolean
    screenshot: boolean
  }
  dingxu?: {
    ok: boolean
    source?: string
    serverName?: string
    serverVersion?: string
    toolCount: number
    humanGuiToolCount: number
    missingTools: string[]
    message: string
  }
  sources?: Array<{
    serverName: string
    status: string
    serverInfo?: {
      name?: string
      version?: string
    }
    toolCount: number
    humanGuiTools?: string[]
    humanGuiToolCount: number
  }>
  capabilities?: string[]
  message: string
}

type SettingsReport = {
  ok: boolean
  cwd: string
  configPath?: string
  config: unknown
  model?: ThreadMetadata['model']
  modelSettings?: ModelSettings
  permissions?: ThreadMetadata['permissions']
  gateway?: {
    enabled?: boolean
    heartbeatIntervalMs?: number
    progressHeartbeatIntervalMs?: number
    wakeHeartbeatIntervalMs?: number
    allowUsers?: string[]
    pairingSecretEnv?: string
  }
  mcp: McpReport[]
  gui: GuiReport
  activeRuns: string[]
  pendingApprovalCount: number
}

type ModelProviderCatalogItem = {
  id: string
  name: string
  defaultModel: string
  model: string
  baseURL?: string
  protocol: 'openai-chat-completions' | 'openai-responses' | string
  authType: 'none' | 'api-key' | 'codex-access-token' | string
  authEnvKeys: string[]
  configured: boolean
  builtin: boolean
  error?: string
  capabilities?: Record<string, boolean | number>
}

type ModelSettings = {
  active: {
    provider: string
    name: string
    model: string
    baseURL: string
    protocol: string
    authType: string
    authEnvKeys: string[]
    capabilities?: Record<string, boolean | number>
  }
  catalog: ModelProviderCatalogItem[]
}

type LoopSummary = {
  metadata: {
    loopId: string
    title: string
    objective: string
    status: string
    trigger: string
    cwd: string
    workspaceIsolation?: 'none' | 'temp_copy' | 'git_worktree'
    currentWorkspaceCwd?: string
    updatedAtMs: number
    threadId?: string
    goalId?: string
  }
  runCount: number
  iterationCount: number
  eventCount: number
  lastRun?: {
    runId: string
    status: string
    finalMessage?: string
    workspaceCwd?: string
    workspaceIsolation?: 'none' | 'temp_copy' | 'git_worktree'
  }
  lastIteration?: {
    iterationId: string
    status: string
    finalTextPreview?: string
    workspaceCwd?: string
  }
}

type LoopData = {
  metadata: LoopSummary['metadata']
  state: string
  runs: unknown[]
  iterations: unknown[]
  events: unknown[]
}

type LoopTrigger = 'manual' | 'schedule' | 'heartbeat'

type GoalStatus = 'active' | 'paused' | 'blocked' | 'usage_limited' | 'budget_limited' | 'completed'

type GoalRequirement = {
  requirementId: string
  text: string
  status: 'incomplete' | 'completed' | 'blocked'
  blocker?: string
  evidenceIds: string[]
}

type GoalEvidence = {
  evidenceId: string
  type: string
  strength: string
  summary: string
  requirementIds?: string[]
  threadId?: string
  loopId?: string
  gatewayRunId?: string
  guiActionId?: string
  acceptanceRunId?: string
  path?: string
  createdAtMs: number
}

type GoalSummary = {
  metadata: {
    goalId: string
    title: string
    status: GoalStatus
    cwd: string
    createdAtMs: number
    updatedAtMs: number
    progressPercent: number
    completedRequirementCount: number
    incompleteRequirementCount: number
    blockerCount: number
    usageRunCount?: number
    usageTimeMs?: number
    usageTokens?: number
    relatedThreadIds: string[]
    relatedLoopIds: string[]
    relatedGatewayRunIds: string[]
    relatedGuiActionIds: string[]
    relatedAcceptanceRunIds: string[]
    relatedFiles: string[]
  }
  objective: string
  requirementCount: number
  evidenceCount: number
  runCount: number
  checkpointCount: number
}

type GoalData = {
  metadata: GoalSummary['metadata']
  objective: string
  requirements: GoalRequirement[]
  progress: Array<{ progressId: string; message: string; createdAtMs: number; progressPercent: number }>
  evidence: GoalEvidence[]
  runs: Array<{ runId: string; kind: string; status: string; summary?: string; startedAtMs: number; completedAtMs?: number }>
  checkpoints: Array<{ checkpointId: string; summary: string; createdAtMs: number; progressPercent: number }>
}

type GatewayChannelView = {
  id: string
  kind: string
  status: string
  outboundStatus?: string
  inboundStatus?: string
  message?: string
}

type AgentRunLedgerEntry = {
  runId: string
  sessionId: string
  threadId: string
  cwd: string
  status: string
  startedAtMs: number
  updatedAtMs: number
  completedAtMs?: number
  durationMs?: number
  model?: {
    provider?: string
    name?: string
  }
  promptPreview?: string
  finalTextPreview?: string
  errorMessage?: string
  eventCount: number
  messageCount?: number
  toolCallCount: number
  toolResultCount: number
  failedToolResultCount: number
  approvalRequestCount: number
  resourceUsage?: {
    rssBytes?: number
    heapUsedBytes?: number
    heapTotalBytes?: number
  }
}

type StaleAgentRunEntry = AgentRunLedgerEntry & {
  ageMs: number
  staleAfterMs: number
}

type GatewayStatus = {
  ok: boolean
  doctor: {
    ok: boolean
    channels: GatewayChannelView[]
    watchdog?: {
      status: string
      ok: boolean
      stale: boolean
      recoverable: boolean
      staleAfterMs: number
      heartbeatAgeMs?: number
      lastHeartbeatAtMs?: number
      message: string
    }
  }
  worker?: {
    running: boolean
    status: string
    sessionId?: string
    startedAtMs?: number
    lastError?: string
  }
  state?: {
    status: string
    heartbeatCount: number
    lastHeartbeatAtMs: number
    connectedChannels: GatewayChannelView[]
    activeLoops: Array<{ loopId: string; title: string; status: string }>
    pendingApprovals: Array<{ approvalId: string; toolName?: string; risk?: string }>
    pairedUsers?: Array<{ channelId: string; channelKind: string; userId: string; pairedAtMs: number; lastSeenAtMs: number }>
    recoveredFrom?: {
      previousSessionId: string
      previousStatus: string
      staleMs: number
      currentActiveLoopCount: number
      currentPendingApprovalCount: number
      pairedUserCount: number
    }
  }
  inbox: Array<{ messageId: string; channelId: string; userId: string; text: string; createdAtMs: number }>
  outbox: Array<{ messageId: string; channelId?: string; userId?: string; text: string; createdAtMs: number; deliveryStatus?: string }>
  recentToolFailures?: Array<{
    threadId: string
    toolName: string
    code: string
    category: string
    message?: string
    createdAtMs: number
    contentPreview?: string
  }>
  recentRuns?: AgentRunLedgerEntry[]
  recentStaleRuns?: StaleAgentRunEntry[]
  pairedUsers: Array<{ channelId: string; channelKind: string; userId: string; pairedAtMs: number; lastSeenAtMs: number }>
  events: Array<{ eventId: string; type: string; message?: string; createdAtMs: number }>
  pendingApprovals: Array<{ approvalId: string; threadId: string; status: string; request: { toolName: string; risk: string } }>
}

type AcceptanceStep = {
  id: string
  status: string
  durationMs: number
  command: string
}

type AcceptanceRun = {
  runId: string
  profile: string
  status: string
  startedAtMs: number
  finishedAtMs: number
  selectedStepCount: number
  totalStepCount: number
  passedStepCount: number
  failedStepCount: number
  durationMs: number
  evidenceRoot?: string
  summaryPath: string
  reportPath: string
  failedSteps: string[]
  steps: AcceptanceStep[]
}

type AcceptanceStatus = {
  ok: boolean
  status: string
  acceptanceRoot: string
  latest?: AcceptanceRun
  runs: AcceptanceRun[]
  error?: string
}

type FileEntry = {
  name: string
  path: string
  relativePath: string
  kind: 'file' | 'directory'
  size?: number
  updatedAtMs?: number
}

type FileListResponse = {
  ok: boolean
  cwd: string
  path: string
  parentPath?: string
  truncated?: boolean
  entries: FileEntry[]
  error?: string
}

type ToolCatalogItem = {
  name: string
  description: string
  safety: string
  platforms: string[]
  behavior: Record<string, boolean>
  concurrency: string
  source: 'pando' | 'mcp' | string
  inputSchema?: Record<string, unknown>
}

type ToolCatalogResponse = {
  ok: boolean
  count: number
  bySafety: Record<string, number>
  tools: ToolCatalogItem[]
}

type TaskView = {
  taskId: string
  title: string
  status: string
  cwd: string
  command?: string
  createdAtMs: number
  updatedAtMs: number
  startedAtMs?: number
  completedAtMs?: number
  exitCode?: number | null
  signal?: string | null
  goalId?: string
  threadId?: string
  loopId?: string
  summary?: string
  outputPath: string
  outputChars: number
  outputPreview?: string
  outputTruncated?: boolean
}

type TaskListResponse = {
  ok: boolean
  tasks: TaskView[]
  count: number
  error?: string
}

type QuestionView = {
  questionId: string
  question: string
  mode: 'blocking' | 'non_blocking'
  status: 'waiting' | 'queued' | 'answered' | 'expired'
  createdAtMs: number
  updatedAtMs: number
  autoResolutionMs?: number
  defaultAnswer?: string
  answer?: string
  answeredAtMs?: number
  answeredBy?: string
  goalId?: string
  taskId?: string
  threadId?: string
  sessionId: string
}

type QuestionListResponse = {
  ok: boolean
  questions: QuestionView[]
  count: number
  waitingCount: number
  error?: string
}

type TimelineRowData = {
  id: string
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'context' | 'error' | 'system'
  title: string
  content: string
  meta?: string
  time: string
  event?: AgentEvent
  streaming?: boolean
}

type ActivityFilter = 'all' | 'tools' | 'runs' | 'gui' | 'approvals' | 'errors'

const ACTIVITY_FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'tools', label: 'Tools' },
  { id: 'runs', label: 'Runs' },
  { id: 'gui', label: 'GUI' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'errors', label: 'Errors' },
]

type InspectorTab = 'inspect' | 'thread' | 'context' | 'tools' | 'goal' | 'loops' | 'gateway' | 'acceptance' | 'files' | 'settings'

const [threads, setThreads] = createSignal<ThreadSummary[]>([])
const [activeThreadId, setActiveThreadId] = createSignal<string>()
const [threadData, setThreadData] = createSignal<ThreadData>()
const [events, setEvents] = createSignal<AgentEvent[]>([])
const [selectedEvent, setSelectedEvent] = createSignal<AgentEvent>()
const [prompt, setPrompt] = createSignal('')
const [running, setRunning] = createSignal(false)
const [doctor, setDoctor] = createSignal<DoctorReport>()
const [mcpReport, setMcpReport] = createSignal<McpReport[]>([])
const [guiReport, setGuiReport] = createSignal<GuiReport>()
const [settings, setSettings] = createSignal<SettingsReport>()
const [files, setFiles] = createSignal<FileListResponse>()
const [filePath, setFilePath] = createSignal('')
const [toolCatalog, setToolCatalog] = createSignal<ToolCatalogResponse>()
const [taskStatus, setTaskStatus] = createSignal<TaskListResponse>()
const [taskWorking, setTaskWorking] = createSignal(false)
const [questions, setQuestions] = createSignal<QuestionListResponse>()
const [questionWorking, setQuestionWorking] = createSignal(false)
const [loops, setLoops] = createSignal<LoopSummary[]>([])
const [activeLoopId, setActiveLoopId] = createSignal<string>()
const [loopData, setLoopData] = createSignal<LoopData>()
const [loopRunning, setLoopRunning] = createSignal(false)
const [goals, setGoals] = createSignal<GoalSummary[]>([])
const [activeGoalId, setActiveGoalId] = createSignal<string>()
const [goalData, setGoalData] = createSignal<GoalData>()
const [goalWorking, setGoalWorking] = createSignal(false)
const [gatewayStatus, setGatewayStatus] = createSignal<GatewayStatus>()
const [gatewayWorking, setGatewayWorking] = createSignal(false)
const [gatewayCommand, setGatewayCommand] = createSignal('/status')
const [acceptanceStatus, setAcceptanceStatus] = createSignal<AcceptanceStatus>()
const [acceptanceRunning, setAcceptanceRunning] = createSignal(false)
const [threadExport, setThreadExport] = createSignal<ThreadExportResponse>()
const [pendingApprovals, setPendingApprovals] = createSignal<PendingApproval[]>([])
const [toast, setToast] = createSignal<string>()
const [sidebarOpen, setSidebarOpen] = createSignal(true)
const [inspectorOpen, setInspectorOpen] = createSignal(false)
const [inspectorTab, setInspectorTab] = createSignal<InspectorTab>('inspect')
const [timelineShouldFollow, setTimelineShouldFollow] = createSignal(true)
const [commandOpen, setCommandOpen] = createSignal(false)

function App() {
  let eventSource: EventSource | undefined
  let timelineRef: HTMLDivElement | undefined
  let timelineContentRef: HTMLDivElement | undefined
  let autoScrollTimer: ReturnType<typeof setTimeout> | undefined
  let keydownHandler: ((event: KeyboardEvent) => void) | undefined

  onMount(async () => {
    keydownHandler = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', keydownHandler)
    await refreshSystemStatus()
    await refreshThreads()
    await refreshGoals()
    await refreshLoops()
    await refreshFiles()
    await refreshTools()
    await refreshTasks()
    await refreshQuestions()
  })

  createEffect(() => {
    const threadId = activeThreadId()
    eventSource?.close()
    eventSource = undefined
    if (!threadId) return
    setTimelineShouldFollow(true)

    void loadThread(threadId)
    const source = new EventSource(`/api/events?threadId=${encodeURIComponent(threadId)}`)
    eventSource = source
    source.addEventListener('agent_event', event => {
      const parsed = parseEventData<AgentEvent>(event)
      if (!parsed) return
      appendEvent(parsed)
    })
    source.addEventListener('approval_pending', event => {
      const parsed = parseEventData<PendingApproval>(event)
      if (!parsed) return
      setPendingApprovals(current => current.some(item => item.approvalId === parsed.approvalId) ? current : [...current, parsed])
      setSelectedEvent({
        type: 'approval_pending',
        approvalId: parsed.approvalId,
        toolName: parsed.request.toolName,
        reason: parsed.request.reason,
        risk: parsed.request.risk,
        input: parsed.request.toolUse.input,
      })
    })
    source.addEventListener('approval_answered', event => {
      const parsed = parseEventData<{ approvalId: string }>(event)
      if (!parsed) return
      setPendingApprovals(current => current.filter(item => item.approvalId !== parsed.approvalId))
    })
  })

  onCleanup(() => {
    eventSource?.close()
    if (autoScrollTimer) clearTimeout(autoScrollTimer)
    if (keydownHandler) window.removeEventListener('keydown', keydownHandler)
  })

  const activeThreadSummary = createMemo(() => threads().find(thread => thread.metadata.threadId === activeThreadId()))
  const activeMetadata = createMemo(() => activeThreadSummary()?.metadata ?? threadData()?.metadata)
  const latestContext = createMemo(() => [...events()].reverse().find(event => event.type === 'context_built'))
  const latestUsage = createMemo(() => [...events()].reverse().find(event => Boolean(event.usage)))
  const latestCompaction = createMemo(() => activeThreadSummary()?.latestCompaction ?? threadData()?.compactions?.at(-1))
  const timelineRows = createMemo(() => buildTimelineRows(events(), threadData()?.messages ?? []))
  const toolEvents = createMemo(() => events().filter(event => rowKind(event) === 'tool'))
  const errorEvents = createMemo(() => events().filter(event => rowKind(event) === 'error'))
  const working = createMemo(() => running() || timelineRows().some(row => row.streaming))
  const activeGoalView = createMemo(() => goalData() ?? goals().find(goal => goal.metadata.goalId === activeGoalId()) ?? goals()[0])
  const recentActivityRows = createMemo(() => [...timelineRows()].slice(-4).reverse())

  createEffect(() => {
    timelineRows()
    working()
    if (!timelineShouldFollow()) return
    autoScrollTimer = setTimeout(() => {
      const timeline = timelineRef
      if (!timeline) return
      markAutoScroll(timeline)
      timeline.scrollTop = timeline.scrollHeight
    }, 0)
  })

  return (
    <main class="opencode-shell" data-sidebar-open={sidebarOpen()} data-inspector-open={inspectorOpen()}>
      <header class="global-topbar">
        <div class="window-controls">
          <button class="topbar-icon" title="Toggle sidebar" onClick={() => setSidebarOpen(!sidebarOpen())}>
            <Icon name={sidebarOpen() ? 'panelLeft' : 'panelRight'} />
          </button>
          <button class="topbar-icon" title="Previous session" disabled={!adjacentThreadId(-1)} onClick={() => selectAdjacentThread(-1)}>
            <Icon name="back" />
          </button>
          <button class="topbar-icon" title="Next session" disabled={!adjacentThreadId(1)} onClick={() => selectAdjacentThread(1)}>
            <Icon name="forward" />
          </button>
        </div>
        <button class="command-search" title="Command search" onClick={() => setCommandOpen(true)}>
          <Icon name="search" />
          <span>Search {activeMetadata()?.title ?? 'Pando'}...</span>
          <kbd>Ctrl+K</kbd>
        </button>
        <div class="topbar-right">
          <button class="topbar-icon" title="Inspector" onClick={() => setInspectorOpen(!inspectorOpen())}>
            <Icon name="layout" />
          </button>
          <button class="topbar-icon" title="Settings" onClick={() => openInspectorTab('settings')}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <aside class="sidebar-shell">
        <div class="sidebar-rail">
          <button class="rail-avatar active" title="Pando workspace" onClick={() => setSidebarOpen(true)}>
            P
          </button>
          <button class="rail-avatar muted rose" title="Model and provider settings" onClick={() => openInspectorTab('settings')}>
            M
          </button>
          <button class="rail-avatar muted green" title="GUI backend status" onClick={() => openInspectorTab('tools')}>
            G
          </button>
          <button class="rail-avatar muted cyan" title="MCP tools" onClick={() => openInspectorTab('tools')}>
            T
          </button>
          <button class="rail-avatar muted amber" title="Goal Dashboard" onClick={() => openInspectorTab('goal')}>
            O
          </button>
          <button class="rail-avatar muted green" title="Loop Engineering" onClick={() => openInspectorTab('loops')}>
            L
          </button>
          <button class="rail-avatar muted cyan" title="Gateway status" onClick={() => openInspectorTab('gateway')}>
            W
          </button>
          <button class="rail-avatar muted amber" title="Acceptance health" onClick={() => openInspectorTab('acceptance')}>
            A
          </button>
          <button class="rail-icon" title="New thread" onClick={createThread}>
            <Icon name="plus" />
          </button>
          <button class="rail-icon" title="Search sessions" onClick={() => setCommandOpen(true)}>
            <Icon name="search" />
          </button>
          <button class="rail-icon" title="Files" onClick={() => openFilesPanel()}>
            <Icon name="files" />
          </button>
          <div class="rail-spacer" />
          <button class="rail-icon" title="Settings" onClick={() => openInspectorTab('settings')}>
            <Icon name="settings" />
          </button>
          <button class="rail-icon" title="Help" onClick={() => showToast('Shortcuts: Ctrl+K command search, Enter send, Shift+Enter newline.')}>
            <Icon name="help" />
          </button>
        </div>

        <section class="session-panel" aria-label="Pando sessions">
          <div class="workspace-card">
            <div class="workspace-copy">
              <strong>Pando</strong>
              <span>{activeMetadata()?.cwd ?? 'Local workspace'}</span>
            </div>
            <button class="icon-button ghost" title="Collapse sidebar" onClick={() => setSidebarOpen(false)}>
              <Icon name="panelLeft" />
            </button>
          </div>

          <button class="new-session-button" onClick={createThread}>
            <Icon name="edit" />
            New session
          </button>

          <div class="sidebar-section-heading">
            <span>Sessions</span>
            <button title="Refresh sessions" onClick={refreshThreads}>
              <Icon name="refresh" />
            </button>
          </div>

          <div class="session-list">
            <For each={threads()}>
              {thread => (
                <button
                  class="session-row"
                  classList={{ active: thread.metadata.threadId === activeThreadId() }}
                  onClick={() => setActiveThreadId(thread.metadata.threadId)}
                >
                  <span class="session-row-title">{thread.metadata.title}</span>
                  <span class="session-row-meta">
                    {modelLabel(thread.metadata)} / {timeAgo(thread.metadata.updatedAtMs)}
                  </span>
                  <span class="session-row-stats">
                    {thread.messageCount} msg / {thread.eventCount} evt
                  </span>
                </button>
              )}
            </For>
            <Show when={!threads().length}>
              <div class="empty-state small">No sessions yet.</div>
            </Show>
          </div>
        </section>
      </aside>

      <section class="session-workspace">
        <header class="session-titlebar">
          <div class="titlebar-left">
            <Show when={!sidebarOpen()}>
              <button class="icon-button" title="Open sidebar" onClick={() => setSidebarOpen(true)}>
                <Icon name="panelRight" />
              </button>
            </Show>
            <div>
              <div class="session-title">{activeMetadata()?.title ?? 'New session'}</div>
              <div class="session-subtitle">{activeThreadId() ?? 'No active thread'}</div>
            </div>
          </div>

          <div class="titlebar-actions">
            <button class="toolbar-button quiet" title="Review context" onClick={() => openInspectorTab('context')}>
              <Icon name="check" />
              Review
            </button>
            <button class="toolbar-button quiet" title="Tool and terminal events" onClick={() => openInspectorTab('tools')}>
              <Icon name="terminal" />
              Terminal
            </button>
            <button class="toolbar-button quiet" title="Open inspector" onClick={() => setInspectorOpen(!inspectorOpen())}>
              <Icon name="layout" />
              Inspect
            </button>
          </div>
        </header>

        <MissionControl
          title={activeMetadata()?.title ?? 'Pando agent workspace'}
          threadId={activeThreadId()}
          cwd={activeMetadata()?.cwd ?? settings()?.cwd ?? 'local workspace'}
          goal={activeGoalView()}
          modelLabel={modelLabel(activeMetadata()) || modelLabelFromDoctor(doctor())}
          modelSettings={settings()?.modelSettings}
          gateway={gatewayStatus()}
          gui={guiReport()}
          rows={recentActivityRows()}
          working={working()}
          onContinue={() => {
            const goalId = activeGoalId()
            if (goalId) void runGoalAction(goalId, 'continue')
            else showToast('Create or select a goal before continuing.')
          }}
          onResume={() => {
            const goalId = activeGoalId()
            if (goalId) void runGoalAction(goalId, 'resume')
            else openInspectorTab('goal')
          }}
          onPause={() => {
            const goalId = activeGoalId()
            if (goalId) void runGoalAction(goalId, 'pause')
            else void stopRun()
          }}
          onOpenGoal={() => openInspectorTab('goal')}
          onOpenGateway={() => openInspectorTab('gateway')}
          onOpenGui={() => openInspectorTab('tools')}
          onOpenSettings={() => openInspectorTab('settings')}
        />

        <div class="context-strip" aria-label="Runtime status strip" data-product-surface="runtime-status">
          <StatusPill label="Model" value={modelLabel(activeMetadata()) || modelLabelFromDoctor(doctor())} />
          <StatusPill label="Permission" value={permissionLabel(activeMetadata())} />
          <StatusPill label="Context" value={contextLabel(latestContext())} />
          <StatusPill label="Compact" value={compactLabel(latestCompaction())} />
          <StatusPill label="Goal" value={goalLabel(goalData() ?? goals()[0])} tone={goalTone(goalData() ?? goals()[0])} />
          <StatusPill label="Doctor" value={doctor()?.ok ? 'ok' : 'check'} tone={doctor()?.ok ? 'ok' : 'warn'} />
          <StatusPill label="GUI" value={guiLabel(guiReport())} tone={guiReport()?.ok ? 'ok' : 'warn'} />
          <StatusPill label="Health" value={acceptanceLabel(acceptanceStatus())} tone={acceptanceStatus()?.latest?.status === 'passed' ? 'ok' : 'warn'} />
          <StatusPill label="Usage" value={usageLabel(latestUsage())} />
        </div>

        <div
          ref={element => { timelineRef = element }}
          class="timeline-viewport"
          data-scrollable
          onScroll={event => handleTimelineScroll(event.currentTarget)}
          onWheel={event => {
            if (event.deltaY < 0) setTimelineShouldFollow(false)
          }}
          onMouseUp={handleTimelineInteraction}
          onKeyUp={handleTimelineInteraction}
        >
          <div ref={element => { timelineContentRef = element }} class="timeline-content">
            <Show when={timelineRows().length} fallback={<NewSessionView onSubmit={submitPromptFromExample} />}>
              <For each={timelineRows()}>
                {row => (
                  <TimelineRow
                    row={row}
                    selected={Boolean(row.event?.id && selectedEvent()?.id === row.event.id)}
                    onSelect={() => row.event && setSelectedEvent(row.event)}
                  />
                )}
              </For>
              <Show when={working()}>
                <div class="thinking-row">
                  <span />
                  <strong>Pando is working</strong>
                </div>
              </Show>
            </Show>
          </div>
        </div>

        <GlobalActivityTimeline
          rows={timelineRows()}
          working={working()}
          selectedEventId={selectedEvent()?.id}
          onSelect={row => row.event && setSelectedEvent(row.event)}
          onOpenTools={() => openInspectorTab('tools')}
        />

        <PromptDock
          prompt={prompt()}
          running={running()}
          modelLabel={modelLabel(activeMetadata()) || modelLabelFromDoctor(doctor())}
          onPrompt={setPrompt}
          onSubmit={submitPrompt}
          onStop={stopRun}
          onOpenCommand={() => setCommandOpen(true)}
          onOpenFiles={() => openFilesPanel()}
          onOpenSettings={() => openInspectorTab('settings')}
        />
      </section>

      <aside class="right-panel" aria-label="Goal, evidence, context, tools, gateway, and settings inspector" data-product-surface="inspector-panel">
        <div class="panel-titlebar">
          <strong>Pando details</strong>
          <button class="topbar-icon" title="Close inspector" onClick={() => setInspectorOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <div class="panel-tabs">
          <InspectorTabButton id="inspect" label="Inspect" />
          <InspectorTabButton id="thread" label="Thread" />
          <InspectorTabButton id="context" label="Context" />
          <InspectorTabButton id="tools" label="Tools" />
          <InspectorTabButton id="goal" label="Goal" />
          <InspectorTabButton id="loops" label="Loop" />
          <InspectorTabButton id="gateway" label="Gate" />
          <InspectorTabButton id="acceptance" label="Health" />
          <InspectorTabButton id="files" label="Files" />
          <InspectorTabButton id="settings" label="Settings" />
        </div>

        <Show when={inspectorTab() === 'inspect'}>
          <InspectPanel event={selectedEvent()} />
        </Show>
        <Show when={inspectorTab() === 'thread'}>
          <ThreadPanel
            thread={activeMetadata()}
            summary={activeThreadSummary()}
            data={threadData()}
            exportResult={threadExport()}
            onRename={renameActiveThread}
            onBranch={branchActiveThread}
            onExport={exportActiveThread}
          />
        </Show>
        <Show when={inspectorTab() === 'context'}>
          <ContextPanel context={latestContext()} compaction={latestCompaction()} doctor={doctor()} />
        </Show>
        <Show when={inspectorTab() === 'tools'}>
          <ToolsPanel
            toolEvents={toolEvents()}
            errorEvents={errorEvents()}
            mcp={mcpReport()}
            gui={guiReport()}
            catalog={toolCatalog()}
            tasks={taskStatus()}
            questions={questions()}
            taskWorking={taskWorking()}
            questionWorking={questionWorking()}
            onRefresh={async () => {
              await refreshTools()
              await refreshTasks()
              await refreshQuestions()
            }}
            onStopTask={stopTaskFromPanel}
            onAnswerQuestion={answerQuestionFromPanel}
          />
        </Show>
        <Show when={inspectorTab() === 'goal'}>
          <GoalPanel
            goals={goals()}
            activeGoalId={activeGoalId()}
            activeGoal={goalData()}
            running={goalWorking()}
            onRefresh={refreshGoals}
            onCreate={createGoalFromPanel}
            onSelect={loadGoal}
            onResume={goalId => runGoalAction(goalId, 'resume')}
            onContinue={goalId => runGoalAction(goalId, 'continue')}
            onPause={goalId => runGoalAction(goalId, 'pause')}
            onBlock={(goalId, reason) => runGoalAction(goalId, 'block', reason)}
            onComplete={goalId => runGoalAction(goalId, 'complete')}
          />
        </Show>
        <Show when={inspectorTab() === 'loops'}>
          <LoopsPanel
            loops={loops()}
            activeLoopId={activeLoopId()}
            activeLoop={loopData()}
            running={loopRunning()}
            onRefresh={refreshLoops}
            onCreate={createLoopFromPanel}
            onSelect={loadLoop}
            onRun={runLoop}
            onResume={resumeLoop}
            onPause={pauseLoop}
            onStop={stopLoop}
          />
        </Show>
        <Show when={inspectorTab() === 'gateway'}>
          <GatewayPanel
            status={gatewayStatus()}
            command={gatewayCommand()}
            running={gatewayWorking()}
            onCommand={setGatewayCommand}
            onStart={startGatewayWorker}
            onRecover={recoverGatewayWorker}
            onStop={stopGatewayWorker}
            onRefresh={refreshGateway}
            onSend={sendGatewayCommand}
          />
        </Show>
        <Show when={inspectorTab() === 'acceptance'}>
          <AcceptancePanel
            status={acceptanceStatus()}
            running={acceptanceRunning()}
            onRefresh={refreshAcceptance}
            onRun={runAcceptance}
          />
        </Show>
        <Show when={inspectorTab() === 'files'}>
          <FilesPanel files={files()} onNavigate={refreshFiles} onSelectFile={appendFileReference} />
        </Show>
        <Show when={inspectorTab() === 'settings'}>
          <SettingsPanel
            settings={settings()}
            doctor={doctor()}
            activeThreadId={activeThreadId()}
            onSaveModel={saveModelSettings}
            onSaveThreadModel={saveThreadModel}
            onSaveRuntime={saveRuntimeSettings}
          />
        </Show>
      </aside>

      <Show when={commandOpen()}>
        <CommandPalette
          threads={threads()}
          activeThreadId={activeThreadId()}
          queryTitle={activeMetadata()?.title ?? 'Pando'}
          onClose={() => setCommandOpen(false)}
          onSelectThread={threadId => {
            setActiveThreadId(threadId)
            setCommandOpen(false)
          }}
          onAction={action => {
            setCommandOpen(false)
            runCommandAction(action)
          }}
        />
      </Show>

      <Show when={pendingApprovals()[0]}>
        {approval => <ApprovalDialog approval={approval()} onRespond={respondApproval} />}
      </Show>
      <Show when={toast()}>
        {message => <div class="toast">{message()}</div>}
      </Show>
    </main>
  )

  function openInspectorTab(tab: InspectorTab) {
    setInspectorTab(tab)
    setInspectorOpen(true)
  }

  function openFilesPanel() {
    openInspectorTab('files')
    void refreshFiles(filePath())
  }

  function adjacentThreadId(direction: -1 | 1): string | undefined {
    const current = activeThreadId()
    const list = threads()
    const index = list.findIndex(thread => thread.metadata.threadId === current)
    if (index < 0) return undefined
    return list[index + direction]?.metadata.threadId
  }

  function selectAdjacentThread(direction: -1 | 1) {
    const next = adjacentThreadId(direction)
    if (next) setActiveThreadId(next)
  }

  async function stopRun() {
    const threadId = activeThreadId()
    if (!threadId) return
    const result = await postJson<{ ok: boolean; stopped?: boolean; message?: string; error?: string }>('/api/stop', { threadId })
    showToast(result.error ?? result.message ?? (result.stopped ? 'Stop requested' : 'No active run'))
    await refreshSystemStatus()
  }

  function appendFileReference(path: string) {
    setPrompt(current => {
      const prefix = current.trimEnd()
      return `${prefix}${prefix ? '\n' : ''}@${path} `
    })
    showToast(`Added @${path}`)
  }

  function runCommandAction(action: string) {
    switch (action) {
      case 'new-session':
        void createThread()
        break
      case 'refresh':
        void refreshThreads()
        void refreshSystemStatus()
        break
      case 'files':
        openFilesPanel()
        break
      case 'tools':
        openInspectorTab('tools')
        break
      case 'thread':
        openInspectorTab('thread')
        break
      case 'goal':
        openInspectorTab('goal')
        void refreshGoals()
        break
      case 'loops':
        openInspectorTab('loops')
        void refreshLoops()
        break
      case 'gateway':
        openInspectorTab('gateway')
        void refreshGateway()
        break
      case 'acceptance':
        openInspectorTab('acceptance')
        void refreshAcceptance()
        break
      case 'context':
        openInspectorTab('context')
        break
      case 'settings':
        openInspectorTab('settings')
        break
      default:
        showToast('Unknown command')
    }
  }

  function InspectorTabButton(props: { id: InspectorTab; label: string }) {
    return (
      <button
        class="panel-tab"
        classList={{ active: inspectorTab() === props.id }}
        onClick={() => setInspectorTab(props.id)}
      >
        {props.label}
      </button>
    )
  }

  function handleTimelineScroll(element: HTMLElement) {
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
    if (remaining <= 32) {
      setTimelineShouldFollow(true)
      return
    }
    if (!isRecentAutoScroll(element)) setTimelineShouldFollow(false)
  }

  function handleTimelineInteraction() {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) setTimelineShouldFollow(false)
  }

  function submitPromptFromExample(value: string) {
    setPrompt(value)
    void submitPrompt(value)
  }
}

function NewSessionView(props: { onSubmit(value: string): void }) {
  const examples = [
    'Summarize this workspace and tell me what to improve next.',
    'Inspect the current Pando thread system and list risks.',
    'Use the GUI layer to check the active desktop app.',
  ]
  return (
    <section class="new-session-view">
      <div class="wordmark">
        <span>P</span>
        <strong>Pando</strong>
      </div>
      <h1>What should Pando work on?</h1>
      <p>Local agent runtime with threads, tools, approvals, compact history, MCP, and GUI automation.</p>
      <div class="example-grid">
        <For each={examples}>
          {example => (
            <button onClick={() => props.onSubmit(example)}>
              <Icon name="spark" />
              {example}
            </button>
          )}
        </For>
      </div>
    </section>
  )
}

function MissionControl(props: {
  title: string
  threadId?: string
  cwd: string
  goal?: GoalSummary | GoalData
  modelLabel: string
  modelSettings?: ModelSettings
  gateway?: GatewayStatus
  gui?: GuiReport
  rows: TimelineRowData[]
  working: boolean
  onContinue(): void
  onResume(): void
  onPause(): void
  onOpenGoal(): void
  onOpenGateway(): void
  onOpenGui(): void
  onOpenSettings(): void
}) {
  const goalProgress = createMemo(() => props.goal?.metadata.progressPercent ?? 0)
  const goalObjective = createMemo(() => props.goal?.objective ?? 'No active goal selected.')
  const provider = createMemo(() => props.modelSettings?.active.provider ?? props.modelLabel.split('/')[0] ?? 'provider')
  const activeModel = createMemo(() => props.modelSettings?.active.model ?? props.modelLabel.split('/')[1] ?? props.modelLabel)
  const capability = createMemo(() => capabilityLabel(props.modelSettings?.active.capabilities))
  const gatewayState = createMemo(() => props.gateway?.worker?.status ?? props.gateway?.state?.status ?? 'stopped')
  const heartbeat = createMemo(() => {
    const state = props.gateway?.state
    if (!state?.lastHeartbeatAtMs) return 'no heartbeat'
    return `${timeAgo(state.lastHeartbeatAtMs)} / ${state.heartbeatCount} beat(s)`
  })
  const guiStatus = createMemo(() => props.gui?.dingxu?.ok ? 'Dingxu ready' : props.gui?.ok ? guiLabel(props.gui) : 'not connected')
  const latest = createMemo(() => props.rows[0])

  return (
    <section class="mission-control" aria-label="Pando mission control" data-product-surface="mission-control">
      <div class="mission-main">
        <div class="mission-kicker">
          <span classList={{ live: props.working }} />
          <strong>{props.working ? 'Agent running' : 'Agent ready'}</strong>
          <small>{props.threadId ?? 'no active thread'}</small>
        </div>
        <h1>{props.title}</h1>
        <p>{goalObjective()}</p>
        <div class="mission-actions">
          <button class="mission-action primary" onClick={props.onContinue}>
            <Icon name="play" />
            Continue
          </button>
          <button class="mission-action" onClick={props.onResume}>
            <Icon name="refresh" />
            Resume
          </button>
          <button class="mission-action" onClick={props.onPause}>
            <Icon name="stop" />
            Pause
          </button>
        </div>
      </div>

      <div class="mission-goal" role="button" tabIndex={0} onClick={props.onOpenGoal} onKeyDown={event => event.key === 'Enter' && props.onOpenGoal()}>
        <div class="mission-section-title">
          <span>Active goal</span>
          <strong>{props.goal?.metadata.status ?? 'none'}</strong>
        </div>
        <div class="goal-progress-ring" style={{ '--progress': `${goalProgress()}%` }}>
          <span>{goalProgress()}%</span>
        </div>
        <div class="mission-stat-line">
          <span>{props.goal?.metadata.completedRequirementCount ?? 0}/{props.goal ? ('requirementCount' in props.goal ? props.goal.requirementCount : props.goal.requirements.length) : 0} requirements</span>
          <span>{props.goal ? ('evidenceCount' in props.goal ? props.goal.evidenceCount : props.goal.evidence.length) : 0} evidence</span>
        </div>
      </div>

      <div class="mission-side">
        <button class="mission-status model" onClick={props.onOpenSettings}>
          <span>Model</span>
          <strong>{provider()} / {activeModel()}</strong>
          <small>{capability()}</small>
        </button>
        <button class="mission-status" onClick={props.onOpenGateway}>
          <span>Gateway</span>
          <strong>{gatewayState()}</strong>
          <small>{heartbeat()}</small>
        </button>
        <button class="mission-status" onClick={props.onOpenGui}>
          <span>GUI automation</span>
          <strong>{guiStatus()}</strong>
          <small>{props.gui?.dingxu?.humanGuiToolCount ?? 0} Dingxu tool(s)</small>
        </button>
      </div>

      <div class="mission-activity">
        <div class="mission-section-title">
          <span>Recent activity</span>
          <strong>{latest()?.title ?? 'idle'}</strong>
        </div>
        <For each={props.rows.slice(0, 3)}>
          {row => (
            <button class="activity-line" title={row.content}>
              <Icon name={rowIcon(row.kind)} />
              <span>{row.title}</span>
              <small>{row.time || 'now'}</small>
            </button>
          )}
        </For>
        <Show when={!props.rows.length}>
          <div class="activity-line muted">
            <Icon name="spark" />
            <span>No activity yet</span>
            <small>{props.cwd}</small>
          </div>
        </Show>
      </div>
    </section>
  )
}

function GlobalActivityTimeline(props: {
  rows: TimelineRowData[]
  working: boolean
  selectedEventId?: string
  onSelect(row: TimelineRowData): void
  onOpenTools(): void
}) {
  const [filter, setFilter] = createSignal<ActivityFilter>('all')
  const counts = createMemo(() => {
    const result: Record<ActivityFilter, number> = {
      all: props.rows.length,
      tools: 0,
      runs: 0,
      gui: 0,
      approvals: 0,
      errors: 0,
    }
    for (const row of props.rows) {
      for (const option of ACTIVITY_FILTERS) {
        if (option.id !== 'all' && activityMatches(row, option.id)) result[option.id] += 1
      }
    }
    return result
  })
  const visibleRows = createMemo(() => props.rows.filter(row => activityMatches(row, filter())).slice(-18).reverse())
  const latest = createMemo(() => props.rows.at(-1))

  return (
    <section class="global-activity-timeline" aria-label="Global activity timeline" data-product-surface="global-activity-timeline">
      <div class="activity-timeline-header">
        <div>
          <span>Activity Timeline</span>
          <strong>{props.working ? 'Live run in progress' : latest()?.title ?? 'No run activity yet'}</strong>
        </div>
        <button class="toolbar-button quiet" type="button" onClick={props.onOpenTools}>
          <Icon name="wrench" />
          Inspect tools
        </button>
      </div>

      <div class="activity-filter-row" aria-label="Activity filters">
        <For each={ACTIVITY_FILTERS}>
          {option => (
            <button
              type="button"
              class="activity-filter"
              classList={{ active: filter() === option.id }}
              onClick={() => setFilter(option.id)}
            >
              <span>{option.label}</span>
              <strong>{counts()[option.id]}</strong>
            </button>
          )}
        </For>
      </div>

      <div class="activity-card-strip" role="list" aria-label="Tool-call timeline">
        <Show when={visibleRows().length} fallback={
          <div class="activity-empty-state">
            <Icon name="spark" />
            <span>No matching activity yet.</span>
          </div>
        }>
          <For each={visibleRows()}>
            {row => (
              <button
                type="button"
                role="listitem"
                class="activity-card"
                data-kind={row.kind}
                classList={{
                  selected: Boolean(row.event?.id && row.event.id === props.selectedEventId),
                  streaming: row.streaming === true,
                }}
                title={row.content}
                onClick={() => props.onSelect(row)}
              >
                <div class="activity-card-top">
                  <span class="activity-card-icon"><Icon name={rowIcon(row.kind)} /></span>
                  <strong>{row.title}</strong>
                  <time>{row.time || 'now'}</time>
                </div>
                <p>{row.content}</p>
                <div class="activity-card-foot">
                  <span>{activityStatus(row)}</span>
                  <small>{row.meta ?? activityFilterLabel(row)}</small>
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </section>
  )
}

function PromptDock(props: {
  prompt: string
  running: boolean
  modelLabel: string
  onPrompt(value: string): void
  onSubmit(value?: string): Promise<void>
  onStop(): Promise<void>
  onOpenCommand(): void
  onOpenFiles(): void
  onOpenSettings(): void
}) {
  function submit(event: SubmitEvent) {
    event.preventDefault()
    void props.onSubmit()
  }

  return (
    <form class="composer-dock" onSubmit={submit}>
      <div class="composer-input-wrap">
        <textarea
          value={props.prompt}
          placeholder="Ask Pando to do something..."
          onInput={event => props.onPrompt(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void props.onSubmit()
            }
          }}
        />
        <button class="composer-plus" type="button" title="Attach workspace file" onClick={props.onOpenFiles}>
          <Icon name="plus" />
        </button>
        <button class="composer-send" type="submit" disabled={props.running || !props.prompt.trim()}>
          <Icon name={props.running ? 'loader' : 'arrowUp'} />
        </button>
      </div>
      <div class="dock-toolbar">
        <button type="button" title="Attach workspace file" onClick={props.onOpenFiles}>
          <Icon name="paperclip" />
        </button>
        <button type="button" title="Browse workspace images" onClick={props.onOpenFiles}>
          <Icon name="image" />
        </button>
        <button type="button" title="Slash commands" onClick={props.onOpenCommand}>
          <Icon name="slash" />
        </button>
        <button type="button" title="Model and run settings" onClick={props.onOpenSettings}>
          <Icon name="model" />
          Build
        </button>
        <button type="button" title="Current model" onClick={props.onOpenSettings}>
          <Icon name="spark" />
          {props.modelLabel}
        </button>
        <div class="dock-spacer" />
        <button class="toolbar-button quiet" type="button" disabled={!props.running} title="Stop current run" onClick={() => void props.onStop()}>
          <Icon name="stop" />
          Stop
        </button>
      </div>
    </form>
  )
}

function TimelineRow(props: { row: TimelineRowData; selected: boolean; onSelect(): void }) {
  return (
    <article
      class="timeline-row"
      classList={{ selected: props.selected, streaming: props.row.streaming === true }}
      data-kind={props.row.kind}
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') props.onSelect()
      }}
    >
      <div class="row-icon">
        <Icon name={rowIcon(props.row.kind)} />
      </div>
      <div class="row-card">
        <div class="row-heading">
          <div>
            <strong>{props.row.title}</strong>
            <Show when={props.row.meta}>
              {meta => <span>{meta()}</span>}
            </Show>
          </div>
          <time>{props.row.time}</time>
        </div>
        <div class="row-content">{props.row.content}</div>
      </div>
    </article>
  )
}

function ApprovalDialog(props: { approval: PendingApproval; onRespond(id: string, decision: string): Promise<void> }) {
  return (
    <div class="dialog-backdrop">
      <section class="approval-dialog" role="dialog" aria-modal="true" aria-label="Approve tool action">
        <div class="permission-icon">
          <Icon name="shield" />
        </div>
        <h2>Approve tool action?</h2>
        <p>
          <strong>{props.approval.request.toolName}</strong> requests {props.approval.request.safety} access under{' '}
          {props.approval.request.sandboxMode}.
        </p>
        <div class="permission-summary">
          <span>Risk</span>
          <strong>{props.approval.request.risk}</strong>
          <p>{props.approval.request.reason}</p>
        </div>
        <pre class="json-view compact">{JSON.stringify(props.approval.request.toolUse.input, null, 2)}</pre>
        <div class="dialog-actions">
          <button class="toolbar-button" onClick={() => props.onRespond(props.approval.approvalId, 'reject')}>
            Reject
          </button>
          <button class="toolbar-button" onClick={() => props.onRespond(props.approval.approvalId, 'approve_always')}>
            Always approve
          </button>
          <button class="send-button" onClick={() => props.onRespond(props.approval.approvalId, 'approve_once')}>
            Approve once
          </button>
        </div>
      </section>
    </div>
  )
}

function InspectPanel(props: { event?: AgentEvent }) {
  return (
    <section class="panel-body">
      <Show when={props.event} fallback={<PlaceholderPanel title="Inspector" copy="Select a timeline row to inspect the raw Pando event." />}>
        {event => (
          <>
            <div class="panel-heading">
              <span>Event</span>
              <strong>{event().type}</strong>
            </div>
            <div class="detail-stack">
              <Detail label="Type" value={event().type} />
              <Detail label="Tool" value={String(event().toolName ?? 'none')} />
              <Detail label="Status" value={statusText(event())} />
              <Show when={failureCode(event())}>
                {code => <Detail label="Failure code" value={code()} />}
              </Show>
              <Show when={failureCategory(event())}>
                {category => <Detail label="Failure category" value={category()} />}
              </Show>
              <Detail label="Reason" value={String(event().reason ?? event().message ?? 'none')} />
              <Show when={event().screenshotPath}>
                <Detail label="Screenshot" value={String(event().screenshotPath)} />
              </Show>
              <pre class="json-view">{JSON.stringify(event(), null, 2)}</pre>
            </div>
          </>
        )}
      </Show>
    </section>
  )
}

function ThreadPanel(props: {
  thread?: ThreadMetadata
  summary?: ThreadSummary
  data?: ThreadData
  exportResult?: ThreadExportResponse
  onRename(title: string): Promise<void>
  onBranch(title: string): Promise<void>
  onExport(format: 'md' | 'json'): Promise<void>
}) {
  const [title, setTitle] = createSignal('')
  const [branchTitle, setBranchTitle] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  createEffect(() => {
    const thread = props.thread
    if (!thread) return
    setTitle(thread.title)
    setBranchTitle(`Branch of ${thread.title}`)
  })

  const runAction = async (action: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="panel-body">
      <Show when={props.thread} fallback={<PlaceholderPanel title="Thread" copy="Create or select a thread to manage it." />}>
        {thread => (
          <>
            <div class="panel-heading">
              <span>Thread</span>
              <strong>{thread().threadId}</strong>
            </div>
            <div class="metric-grid">
              <Metric label="Messages" value={String(props.summary?.messageCount ?? props.data?.messages.length ?? 0)} />
              <Metric label="Events" value={String(props.summary?.eventCount ?? props.data?.events.length ?? 0)} />
              <Metric label="Checkpoints" value={String(props.summary?.checkpointCount ?? props.data?.checkpoints.length ?? 0)} />
              <Metric label="Compactions" value={String(props.summary?.compactionCount ?? props.data?.compactions.length ?? 0)} />
            </div>
            <Detail label="Model" value={modelLabel(thread()) || 'default'} />
            <Detail label="Workspace" value={thread().cwd} />
            <Detail label="Parent" value={thread().parentThreadId ?? 'none'} />
            <div class="panel-form">
              <label class="field-label">
                Title
                <input class="panel-input" value={title()} onInput={event => setTitle(event.currentTarget.value)} />
              </label>
              <div class="button-row">
                <button class="primary-button" disabled={busy()} onClick={() => void runAction(() => props.onRename(title()))}>
                  Rename
                </button>
              </div>
              <label class="field-label">
                Branch title
                <input class="panel-input" value={branchTitle()} onInput={event => setBranchTitle(event.currentTarget.value)} />
              </label>
              <div class="button-row">
                <button class="secondary-button" disabled={busy()} onClick={() => void runAction(() => props.onBranch(branchTitle()))}>
                  Branch
                </button>
                <button class="toolbar-button" disabled={busy()} onClick={() => void runAction(() => props.onExport('md'))}>
                  Export MD
                </button>
                <button class="toolbar-button" disabled={busy()} onClick={() => void runAction(() => props.onExport('json'))}>
                  Export JSON
                </button>
              </div>
            </div>
            <Show when={props.exportResult}>
              {exportResult => (
                <textarea
                  class="panel-textarea export-preview"
                  readonly
                  value={exportResult().content}
                  aria-label={`Thread export ${exportResult().format}`}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}

function ContextPanel(props: { context?: AgentEvent; compaction?: unknown; doctor?: DoctorReport }) {
  return (
    <section class="panel-body">
      <div class="panel-heading">
        <span>Context</span>
        <strong>{contextLabel(props.context)}</strong>
      </div>
      <div class="metric-grid">
        <Metric label="Retained" value={String(props.context?.retainedMessageCount ?? 0)} />
        <Metric label="Source" value={String(props.context?.sourceMessageCount ?? 0)} />
        <Metric label="Dropped" value={String(props.context?.droppedMessageCount ?? 0)} />
        <Metric label="Compacted" value={String(props.context?.compactedMessageCount ?? 0)} />
      </div>
      <Detail label="Compact" value={compactLabel(props.compaction)} />
      <Detail label="Doctor" value={props.doctor?.ok ? 'ok' : 'check required'} />
      <pre class="json-view compact">{JSON.stringify(props.context ?? props.doctor ?? {}, null, 2)}</pre>
    </section>
  )
}

function ToolsPanel(props: {
  toolEvents: AgentEvent[]
  errorEvents: AgentEvent[]
  mcp: McpReport[]
  gui?: GuiReport
  catalog?: ToolCatalogResponse
  tasks?: TaskListResponse
  questions?: QuestionListResponse
  taskWorking: boolean
  questionWorking: boolean
  onRefresh(): Promise<void>
  onStopTask(taskId: string): Promise<void>
  onAnswerQuestion(questionId: string, answer: string): Promise<void>
}) {
  const [questionAnswers, setQuestionAnswers] = createSignal<Record<string, string>>({})
  const tools = createMemo(() => props.catalog?.tools ?? [])
  const pandoTools = createMemo(() => tools().filter(tool => tool.source !== 'mcp'))
  const mcpTools = createMemo(() => tools().filter(tool => tool.source === 'mcp'))
  const backgroundTasks = createMemo(() => props.tasks?.tasks ?? [])
  const activeTasks = createMemo(() => backgroundTasks().filter(task => task.status === 'running' || task.status === 'queued'))
  const completedTasks = createMemo(() => backgroundTasks().filter(task => task.status === 'completed'))
  const failedTasks = createMemo(() => backgroundTasks().filter(task => task.status === 'failed'))
  const questionItems = createMemo(() => props.questions?.questions ?? [])
  const waitingQuestions = createMemo(() => questionItems().filter(question => question.status === 'waiting' || question.status === 'queued'))
  const latestToolEvent = createMemo(() => [...props.toolEvents].reverse()[0])
  const latestErrorEvent = createMemo(() => [...props.errorEvents].reverse()[0])
  const guiEvents = createMemo(() => props.toolEvents.filter(event => event.type.includes('gui_action') || event.screenshotPath))
  const mcpConnectedCount = createMemo(() => props.mcp.filter(server => server.status === 'connected').length)
  const runHeadline = createMemo(() => {
    const task = activeTasks()[0]
    if (task) return task.title
    const question = waitingQuestions()[0]
    if (question) return question.question
    const event = latestToolEvent()
    return event ? toolEventPreview(event) : 'No active tool run.'
  })
  const runState = createMemo(() => {
    if (activeTasks().length > 0) return 'running'
    if (waitingQuestions().length > 0) return 'waiting'
    if (props.errorEvents.length > 0 || failedTasks().length > 0) return 'needs review'
    return 'idle'
  })
  async function answerQuestion(questionId: string) {
    const answer = questionAnswers()[questionId]?.trim()
    if (!answer) {
      showToast('Enter an answer first')
      return
    }
    await props.onAnswerQuestion(questionId, answer)
    setQuestionAnswers(current => ({ ...current, [questionId]: '' }))
  }
  return (
    <section class="panel-body" aria-label="Tools, runs, questions, and GUI automation panel" data-product-surface="tools-runs-gui">
      <div class="panel-heading">
        <span>Tools</span>
        <strong>{tools().length} registered</strong>
      </div>
      <div class="tool-command-center" aria-label="Tool activity command center" data-product-surface="tool-activity-command-center">
        <div class="tool-command-main">
          <div class="tool-command-status">
            <span classList={{ active: runState() === 'running', waiting: runState() === 'waiting', danger: runState() === 'needs review' }} />
            <strong>{runState()}</strong>
            <small>{latestToolEvent()?.createdAtMs ? timeAgo(latestToolEvent()!.createdAtMs!) : 'live workspace'}</small>
          </div>
          <h2>{runHeadline()}</h2>
          <p>
            {activeTasks().length
              ? `${activeTasks().length} background task(s) running or queued.`
              : waitingQuestions().length
                ? `${waitingQuestions().length} user question(s) need input.`
                : latestToolEvent()
                  ? `Latest tool: ${latestToolEvent()?.toolName ?? latestToolEvent()?.action ?? latestToolEvent()?.type}.`
                  : 'Tool calls, task logs, GUI evidence, and errors will appear here as the run progresses.'}
          </p>
          <Show when={latestErrorEvent()}>
            {event => (
              <button class="tool-error-line" onClick={() => setSelectedEvent(event())}>
                <Icon name="warning" />
                <span>{failureLabel(event()) ?? statusText(event())}</span>
                <strong>{toolEventPreview(event())}</strong>
              </button>
            )}
          </Show>
        </div>
        <div class="tool-command-actions">
          <button class="mission-action primary" disabled={props.taskWorking} onClick={() => void props.onRefresh()}>
            <Icon name="refresh" />
            Refresh tools
          </button>
          <button
            class="mission-action"
            disabled={props.taskWorking || !activeTasks()[0]}
            onClick={() => activeTasks()[0] && void props.onStopTask(activeTasks()[0].taskId)}
          >
            <Icon name="stop" />
            Stop task
          </button>
        </div>
        <div class="tool-run-grid" aria-label="Run state cards">
          <RunStateCard label="Running tasks" value={String(activeTasks().length)} detail={activeTasks()[0]?.taskId ?? 'none'} tone={activeTasks().length ? 'ok' : undefined} />
          <RunStateCard label="Waiting questions" value={String(waitingQuestions().length)} detail={waitingQuestions()[0]?.mode ?? 'none'} tone={waitingQuestions().length ? 'warn' : undefined} />
          <RunStateCard label="Failed signals" value={String(props.errorEvents.length + failedTasks().length)} detail={latestErrorEvent()?.type ?? failedTasks()[0]?.taskId ?? 'none'} tone={props.errorEvents.length || failedTasks().length ? 'danger' : undefined} />
          <RunStateCard label="Completed tasks" value={String(completedTasks().length)} detail={completedTasks()[0]?.taskId ?? 'none'} />
        </div>
        <div class="tool-signal-strip" aria-label="Tool evidence signals">
          <button type="button">
            <Icon name="wrench" />
            {pandoTools().length} Pando tools
          </button>
          <button type="button">
            <Icon name="layers" />
            {mcpConnectedCount()}/{props.mcp.length} MCP connected
          </button>
          <button type="button">
            <Icon name="settings" />
            GUI {props.gui?.ok ? guiLabel(props.gui) : 'unavailable'}
          </button>
          <button type="button">
            <Icon name="image" />
            {guiEvents().length} screenshot signal(s)
          </button>
        </div>
      </div>
      <div class="metric-grid">
        <Metric label="Pando" value={String(pandoTools().length)} />
        <Metric label="MCP" value={String(mcpTools().length || props.mcp.reduce((count, server) => count + server.toolCount, 0))} />
        <Metric label="Tasks" value={String(backgroundTasks().length)} />
        <Metric label="Running" value={String(activeTasks().length)} />
        <Metric label="Questions" value={String(waitingQuestions().length)} />
        <Metric label="UIA" value={props.gui?.methods.uia ? 'on' : 'off'} />
        <Metric label="Errors" value={String(props.errorEvents.length)} />
      </div>

      <div class="panel-heading subtle">
        <span>Available tools</span>
        <strong>{props.catalog?.count ?? 0}</strong>
      </div>
      <div class="tool-list">
        <For each={tools().slice(0, 18)}>
          {tool => (
            <article class="tool-card static">
              <span>{tool.name}</span>
              <strong>{tool.safety} / {tool.concurrency}</strong>
              <small>{tool.description}</small>
              <div class="chip-row">
                <button type="button">{tool.source}</button>
                <button type="button">{tool.platforms.join(', ')}</button>
                <Show when={toolBehaviorSummary(tool)}>
                  {summary => <button type="button">{summary()}</button>}
                </Show>
              </div>
            </article>
          )}
        </For>
        <Show when={!tools().length}>
          <div class="empty-state small">No tool catalog has been loaded yet.</div>
        </Show>
      </div>

      <div class="panel-heading subtle">
        <span>User questions</span>
        <strong>{props.questions?.waitingCount ?? 0} waiting</strong>
      </div>
      <div class="tool-list">
        <For each={questionItems().slice(0, 8)}>
          {question => (
            <article classList={{ 'tool-card': true, static: true, danger: question.status === 'expired' }}>
              <span>{question.questionId}</span>
              <strong>{question.status} / {question.mode}</strong>
              <small>{question.question}</small>
              <Show when={question.answer}>
                {answer => <small>answer: {answer()}</small>}
              </Show>
              <Show when={question.status === 'waiting' || question.status === 'queued'}>
                <div class="panel-form compact">
                  <input
                    class="panel-input"
                    value={questionAnswers()[question.questionId] ?? ''}
                    onInput={event => setQuestionAnswers(current => ({ ...current, [question.questionId]: event.currentTarget.value }))}
                    placeholder="Answer this question"
                  />
                  <button
                    class="toolbar-button primary"
                    disabled={props.questionWorking || !questionAnswers()[question.questionId]?.trim()}
                    onClick={() => void answerQuestion(question.questionId)}
                  >
                    Answer
                  </button>
                </div>
              </Show>
              <div class="chip-row">
                <Show when={question.goalId}>
                  {goalId => <button type="button">goal {goalId()}</button>}
                </Show>
                <Show when={question.taskId}>
                  {taskId => <button type="button">task {taskId()}</button>}
                </Show>
                <Show when={question.threadId}>
                  {threadId => <button type="button">thread {threadId()}</button>}
                </Show>
                <Show when={question.defaultAnswer}>
                  {defaultAnswer => <button type="button">default {defaultAnswer()}</button>}
                </Show>
              </div>
            </article>
          )}
        </For>
        <Show when={!questionItems().length}>
          <div class="empty-state small">No user questions yet.</div>
        </Show>
      </div>

      <div class="panel-heading subtle">
        <span>Background tasks</span>
        <strong>{props.tasks?.count ?? 0}</strong>
      </div>
      <div class="tool-list">
        <For each={backgroundTasks().slice(0, 8)}>
          {task => (
            <article classList={{ 'tool-card': true, static: true, danger: task.status === 'failed' }}>
              <span>{task.taskId}</span>
              <strong>{task.status} / {taskDuration(task)}</strong>
              <small>{task.title}</small>
              <Show when={task.command}>
                {command => <small>{command()}</small>}
              </Show>
              <Show when={task.outputPreview}>
                {output => <pre class="json-view compact">{output()}</pre>}
              </Show>
              <div class="chip-row">
                <Show when={task.goalId}>
                  {goalId => <button type="button">goal {goalId()}</button>}
                </Show>
                <Show when={task.threadId}>
                  {threadId => <button type="button">thread {threadId()}</button>}
                </Show>
                <Show when={task.loopId}>
                  {loopId => <button type="button">loop {loopId()}</button>}
                </Show>
                <Show when={task.status === 'running' || task.status === 'queued'}>
                  <button type="button" disabled={props.taskWorking} onClick={() => void props.onStopTask(task.taskId)}>Stop</button>
                </Show>
              </div>
            </article>
          )}
        </For>
        <Show when={!backgroundTasks().length}>
          <div class="empty-state small">No background tasks yet.</div>
        </Show>
      </div>

      <Show when={props.gui?.dingxu}>
        {dingxu => (
          <article class="tool-card static">
            <span>Dingxu core</span>
            <strong>{dingxu().source ?? 'not connected'} / {dingxu().humanGuiToolCount} human GUI</strong>
            <small>{dingxu().message}</small>
            <Show when={dingxu().missingTools.length}>
              <small>Missing: {dingxu().missingTools.slice(0, 6).join(', ')}{dingxu().missingTools.length > 6 ? ` +${dingxu().missingTools.length - 6}` : ''}</small>
            </Show>
          </article>
        )}
      </Show>
      <Show when={props.gui?.sources?.length}>
        <div class="tool-list compact">
          <For each={props.gui?.sources}>
            {source => (
              <article class="tool-card static">
                <span>{source.serverName}</span>
                <strong>{source.serverInfo?.name ?? source.status}</strong>
                <small>{source.toolCount} tool(s), {source.humanGuiToolCount} human GUI</small>
              </article>
            )}
          </For>
        </div>
      </Show>
      <div class="tool-list">
        <For each={props.mcp}>
          {server => (
            <article class="tool-card static">
              <span>{server.serverName}</span>
              <strong>{server.status === 'connected' ? `${server.toolCount} tools` : 'failed'}</strong>
              <small>
                {server.serverInfo?.name ?? 'unknown'} {server.serverInfo?.version ?? ''}
                {server.error ? ` - ${server.error}` : ''}
              </small>
              <div class="chip-row">
                <For each={server.tools.slice(0, 8)}>
                  {tool => <button type="button" onClick={() => showToast(tool.name)}>{tool.name}</button>}
                </For>
                <Show when={server.tools.length > 8}>
                  <button type="button">+{server.tools.length - 8}</button>
                </Show>
              </div>
            </article>
          )}
        </For>
        <Show when={!props.mcp.length}>
          <div class="empty-state small">No MCP servers configured.</div>
        </Show>
      </div>
      <div class="panel-heading subtle">
        <span>Recent tool events</span>
        <strong>{props.toolEvents.length} event(s)</strong>
      </div>
      <div class="tool-list">
        <For each={props.toolEvents.slice(-12).reverse()}>
          {event => (
            <button class="tool-card" onClick={() => setSelectedEvent(event)}>
              <span>{event.toolName ?? event.action ?? event.type}</span>
              <strong>{statusText(event)}</strong>
              <Show when={failureLabel(event)}>
                {label => <em class="failure-chip">{label()}</em>}
              </Show>
              <small>{toolEventPreview(event)}</small>
            </button>
          )}
        </For>
        <Show when={!props.toolEvents.length}>
          <div class="empty-state small">No tool calls yet.</div>
        </Show>
      </div>
      <Show when={props.errorEvents.length}>
        <div class="panel-heading subtle">
          <span>Errors</span>
          <strong>{props.errorEvents.length}</strong>
        </div>
        <div class="tool-list">
          <For each={props.errorEvents.slice(-8).reverse()}>
            {event => (
              <button class="tool-card danger" onClick={() => setSelectedEvent(event)}>
                <span>{event.toolName ?? event.action ?? event.type}</span>
                <strong>{failureLabel(event) ?? statusText(event)}</strong>
                <small>{toolEventPreview(event)}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

function toolBehaviorSummary(tool: ToolCatalogItem): string {
  return Object.entries(tool.behavior)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ')
}

function taskDuration(task: TaskView): string {
  const started = task.startedAtMs ?? task.createdAtMs
  const ended = task.completedAtMs ?? Date.now()
  return formatDuration(Math.max(0, ended - started))
}

function GoalPanel(props: {
  goals: GoalSummary[]
  activeGoalId?: string
  activeGoal?: GoalData
  running: boolean
  onRefresh(): Promise<void>
  onCreate(input: { title: string; objective: string; requirements: string[] }): Promise<void>
  onSelect(goalId: string): Promise<void>
  onResume(goalId: string): Promise<void>
  onContinue(goalId: string): Promise<void>
  onPause(goalId: string): Promise<void>
  onBlock(goalId: string, reason: string): Promise<void>
  onComplete(goalId: string): Promise<void>
}) {
  const [title, setTitle] = createSignal('Pando product goal')
  const [objective, setObjective] = createSignal('Make this workspace demonstrably more mature and recoverable.')
  const [requirements, setRequirements] = createSignal('Pass focused smoke tests\nWrite explicit evidence')
  const [blockReason, setBlockReason] = createSignal('')
  const active = createMemo(() => props.activeGoal ?? props.goals.find(goal => goal.metadata.goalId === props.activeGoalId))
  const activeRequirementTotal = createMemo(() => {
    const goal = active()
    if (!goal) return 0
    return 'requirements' in goal ? goal.requirements.length : goal.requirementCount
  })
  const activeEvidenceTotal = createMemo(() => {
    const goal = active()
    if (!goal) return 0
    return 'evidence' in goal ? goal.evidence.length : goal.evidenceCount
  })
  const activeRunTotal = createMemo(() => {
    const goal = active()
    if (!goal) return 0
    return 'runs' in goal ? goal.runs.length : goal.runCount
  })
  const activeRequirements = createMemo(() => props.activeGoal?.requirements ?? [])
  const activeEvidence = createMemo(() => props.activeGoal?.evidence ?? [])
  const activeRuns = createMemo(() => props.activeGoal?.runs ?? [])
  const activeProgress = createMemo(() => active()?.metadata.progressPercent ?? 0)
  const completionReady = createMemo(() => {
    const goal = active()
    if (!goal) return false
    const total = activeRequirementTotal()
    return total > 0 &&
      goal.metadata.completedRequirementCount === total &&
      activeEvidenceTotal() > 0 &&
      goal.metadata.blockerCount === 0
  })
  const linkedWorkCount = createMemo(() => {
    const metadata = active()?.metadata
    if (!metadata) return 0
    return metadata.relatedThreadIds.length +
      metadata.relatedLoopIds.length +
      metadata.relatedGatewayRunIds.length +
      metadata.relatedGuiActionIds.length +
      metadata.relatedAcceptanceRunIds.length +
      metadata.relatedFiles.length
  })

  async function submitCreate() {
    await props.onCreate({
      title: title().trim(),
      objective: objective().trim(),
      requirements: requirements().split(/\r?\n/).map(item => item.trim()).filter(Boolean),
    })
  }

  return (
    <section class="panel-body" aria-label="Goal dashboard" data-product-surface="goal-dashboard">
      <div class="panel-heading goal-dashboard-title">
        <span>Goal Dashboard</span>
        <strong>{active()?.metadata.title ?? 'No active goal'}</strong>
      </div>
      <Show when={props.activeGoal}>
        {goal => (
          <>
            <section class="goal-dashboard-hero" aria-label="Active goal command center">
              <div class="goal-hero-copy">
                <div class="goal-hero-status">
                  <span classList={{ 'status-dot': true, ok: goal().metadata.status === 'active' || goal().metadata.status === 'completed', warn: goal().metadata.status !== 'active' && goal().metadata.status !== 'completed' }} />
                  <strong>{goal().metadata.status}</strong>
                  <small>updated {timeAgo(goal().metadata.updatedAtMs)}</small>
                </div>
                <h2>{goal().metadata.title}</h2>
                <p>{goal().objective}</p>
                <div class="goal-control-row">
                  <button class="mission-action primary" disabled={props.running} onClick={() => void props.onContinue(goal().metadata.goalId)}>
                    <Icon name="play" />
                    Continue
                  </button>
                  <button class="mission-action" disabled={props.running} onClick={() => void props.onResume(goal().metadata.goalId)}>
                    <Icon name="refresh" />
                    Resume
                  </button>
                  <button class="mission-action" disabled={props.running} onClick={() => void props.onPause(goal().metadata.goalId)}>
                    <Icon name="stop" />
                    Pause
                  </button>
                </div>
              </div>
              <div class="goal-hero-meter">
                <div class="goal-progress-ring large" style={{ '--progress': `${activeProgress()}%` }}>
                  <span>{activeProgress()}%</span>
                </div>
                <strong>{completionReady() ? 'Ready to complete' : 'Evidence required'}</strong>
                <small>{goal().metadata.completedRequirementCount}/{activeRequirementTotal()} requirements, {activeEvidenceTotal()} evidence</small>
              </div>
            </section>

            <section class="goal-readiness-panel" aria-label="Completion readiness">
              <div class="panel-heading compact">
                <span>Completion readiness</span>
                <strong>{completionReady() ? 'direct evidence available' : 'not yet proven'}</strong>
              </div>
              <div class="goal-readiness-grid">
                <article classList={{ 'readiness-item': true, ready: activeRequirementTotal() > 0 && goal().metadata.completedRequirementCount === activeRequirementTotal() }}>
                  <Icon name="check" />
                  <span>Requirements</span>
                  <strong>{goal().metadata.completedRequirementCount}/{activeRequirementTotal()}</strong>
                </article>
                <article classList={{ 'readiness-item': true, ready: activeEvidenceTotal() > 0 }}>
                  <Icon name="shield" />
                  <span>Evidence</span>
                  <strong>{activeEvidenceTotal()}</strong>
                </article>
                <article classList={{ 'readiness-item': true, ready: goal().metadata.blockerCount === 0 }}>
                  <Icon name="warning" />
                  <span>Blockers</span>
                  <strong>{goal().metadata.blockerCount}</strong>
                </article>
                <article classList={{ 'readiness-item': true, ready: activeRunTotal() > 0 }}>
                  <Icon name="terminal" />
                  <span>Linked runs</span>
                  <strong>{activeRunTotal()}</strong>
                </article>
              </div>
            </section>

            <div class="goal-dashboard-actions">
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onComplete(goal().metadata.goalId)}>Complete</button>
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onRefresh()}>Refresh</button>
            </div>
            <div class="panel-form compact goal-block-form">
              <input class="panel-input" value={blockReason()} onInput={event => setBlockReason(event.currentTarget.value)} placeholder="Block reason" />
              <button class="toolbar-button" disabled={props.running || !blockReason().trim()} onClick={() => void props.onBlock(goal().metadata.goalId, blockReason().trim())}>Block</button>
            </div>

            <section class="goal-linked-panel" aria-label="Linked work">
              <div class="panel-heading compact">
                <span>Linked work</span>
                <strong>{linkedWorkCount()} item(s)</strong>
              </div>
              <div class="goal-linked-grid">
                <Metric label="Threads" value={String(goal().metadata.relatedThreadIds.length)} />
                <Metric label="Loops" value={String(goal().metadata.relatedLoopIds.length)} />
                <Metric label="Gateway" value={String(goal().metadata.relatedGatewayRunIds.length)} />
                <Metric label="GUI" value={String(goal().metadata.relatedGuiActionIds.length)} />
                <Metric label="Acceptance" value={String(goal().metadata.relatedAcceptanceRunIds.length)} />
                <Metric label="Files" value={String(goal().metadata.relatedFiles.length)} />
              </div>
              <Detail label="Goal ID" value={goal().metadata.goalId} />
              <Detail label="Usage" value={`${goal().metadata.usageRunCount ?? 0} run(s), ${formatDuration(goal().metadata.usageTimeMs ?? 0)}, ${formatNumber(goal().metadata.usageTokens ?? 0)} token(s)`} />
            </section>

            <div class="panel-heading subtle">
              <span>Requirement checklist</span>
              <strong>{goal().requirements.length}</strong>
            </div>
            <div class="tool-list">
              <For each={activeRequirements()}>
                {requirement => (
                  <article classList={{ 'tool-card': true, static: true, danger: requirement.status === 'blocked', active: requirement.status === 'completed' }}>
                    <span>{requirement.status}</span>
                    <strong>{requirement.evidenceIds.length} evidence item(s)</strong>
                    <small>{requirement.text}</small>
                    <small>{requirement.requirementId}</small>
                    <Show when={requirement.blocker}>
                      {blocker => <small>blocker: {blocker()}</small>}
                    </Show>
                  </article>
                )}
              </For>
            </div>
            <div class="panel-heading subtle">
              <span>Evidence ledger</span>
              <strong>{goal().evidence.length}</strong>
            </div>
            <div class="tool-list">
              <For each={activeEvidence().slice(-8).reverse()}>
                {evidence => (
                  <article classList={{ 'tool-card': true, static: true, danger: evidence.strength === 'weak' }}>
                    <span>{evidence.type} / {evidence.strength}</span>
                    <strong>{evidence.requirementIds?.join(', ') || 'unbound'}</strong>
                    <small>{evidence.summary}</small>
                    <small>{evidence.path ?? evidence.threadId ?? evidence.loopId ?? evidence.gatewayRunId ?? evidence.guiActionId ?? evidence.acceptanceRunId ?? evidence.evidenceId}</small>
                  </article>
                )}
              </For>
              <Show when={!goal().evidence.length}>
                <div class="empty-state small">No goal evidence yet.</div>
              </Show>
            </div>
            <div class="panel-heading subtle">
              <span>Recent runs</span>
              <strong>{goal().runs.length}</strong>
            </div>
            <div class="tool-list">
              <For each={activeRuns().slice(-6).reverse()}>
                {run => (
                  <article class="tool-card static">
                    <span>{run.kind} / {run.status}</span>
                    <strong>{run.runId}</strong>
                    <small>{run.summary ?? 'No summary'}</small>
                    <small>{run.completedAtMs ? `completed ${timeAgo(run.completedAtMs)}` : `started ${timeAgo(run.startedAtMs)}`}</small>
                  </article>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
      <Show when={!props.activeGoal}>
        <div class="empty-state small">Create or select a goal to see objective, requirements, evidence, linked work, and completion readiness.</div>
      </Show>

      <section class="goal-create-panel" aria-label="Create goal">
        <div class="panel-heading compact">
          <span>Create goal</span>
          <strong>persistent objective</strong>
        </div>
        <div class="panel-form">
          <input class="panel-input" value={title()} onInput={event => setTitle(event.currentTarget.value)} placeholder="Goal title" />
          <textarea class="panel-textarea" value={objective()} onInput={event => setObjective(event.currentTarget.value)} placeholder="Goal objective" />
          <textarea class="panel-textarea" value={requirements()} onInput={event => setRequirements(event.currentTarget.value)} placeholder="One requirement per line" />
          <button class="send-button" disabled={!objective().trim() || props.running} onClick={() => void submitCreate()}>
            Create goal
          </button>
        </div>
      </section>

      <div class="panel-heading subtle">
        <span>All goals</span>
        <strong>{props.goals.length}</strong>
      </div>
      <div class="tool-list">
        <For each={props.goals}>
          {goal => (
            <button
              class="tool-card"
              classList={{ active: goal.metadata.goalId === props.activeGoalId }}
              onClick={() => void props.onSelect(goal.metadata.goalId)}
            >
              <span>{goal.metadata.title}</span>
              <strong>{goal.metadata.status} / {goal.metadata.progressPercent}% / {goal.metadata.completedRequirementCount}/{goal.requirementCount}</strong>
              <small>{goal.objective}</small>
            </button>
          )}
        </For>
        <Show when={!props.goals.length}>
          <div class="empty-state small">No goals yet.</div>
        </Show>
      </div>
    </section>
  )
}

function LoopsPanel(props: {
  loops: LoopSummary[]
  activeLoopId?: string
  activeLoop?: LoopData
  running: boolean
  onRefresh(): Promise<void>
  onCreate(input: { title: string; objective: string; trigger: LoopTrigger; verifyCommand: string; maxIterations: number; maxTokens: number; manualInterventionAfterFailures?: number; workspaceIsolation: 'none' | 'temp_copy' | 'git_worktree' }): Promise<void>
  onSelect(loopId: string): Promise<void>
  onRun(loopId: string): Promise<void>
  onResume(loopId: string): Promise<void>
  onPause(loopId: string): Promise<void>
  onStop(loopId: string): Promise<void>
}) {
  const [title, setTitle] = createSignal('Web loop')
  const [objective, setObjective] = createSignal('Create loop-output.txt with the exact text loop-ok.')
  const [verifyCommand, setVerifyCommand] = createSignal('node verify-loop.mjs')
  const [trigger, setTrigger] = createSignal<LoopTrigger>('manual')
  const [maxIterations, setMaxIterations] = createSignal('2')
  const [maxTokens, setMaxTokens] = createSignal('100000')
  const [manualInterventionAfterFailures, setManualInterventionAfterFailures] = createSignal('')
  const [workspaceIsolation, setWorkspaceIsolation] = createSignal<'none' | 'temp_copy' | 'git_worktree'>('none')
  const active = createMemo(() => props.loops.find(loop => loop.metadata.loopId === props.activeLoopId))

  async function submitCreate() {
    await props.onCreate({
      title: title().trim(),
      objective: objective().trim(),
      trigger: trigger(),
      verifyCommand: verifyCommand().trim(),
      maxIterations: Number(maxIterations()) || 2,
      maxTokens: Number(maxTokens()) || 100000,
      manualInterventionAfterFailures: Number(manualInterventionAfterFailures()) || undefined,
      workspaceIsolation: workspaceIsolation(),
    })
  }

  return (
    <section class="panel-body" aria-label="Loop and task monitor" data-product-surface="loop-task-monitor">
      <div class="panel-heading">
        <span>Loop Engineering</span>
        <strong>{props.loops.length} loop(s)</strong>
      </div>
      <div class="metric-grid">
        <Metric label="Active" value={active()?.metadata.status ?? 'none'} />
        <Metric label="Runs" value={String(active()?.runCount ?? 0)} />
        <Metric label="Iterations" value={String(active()?.iterationCount ?? 0)} />
        <Metric label="Events" value={String(active()?.eventCount ?? 0)} />
      </div>
      <div class="panel-form">
        <input class="panel-input" value={title()} onInput={event => setTitle(event.currentTarget.value)} placeholder="Loop title" />
        <textarea class="panel-textarea" value={objective()} onInput={event => setObjective(event.currentTarget.value)} placeholder="Loop objective" />
        <select class="panel-input" value={trigger()} onInput={event => setTrigger(event.currentTarget.value as LoopTrigger)}>
          <option value="manual">trigger: manual</option>
          <option value="schedule">trigger: schedule</option>
          <option value="heartbeat">trigger: heartbeat</option>
        </select>
        <input class="panel-input" value={verifyCommand()} onInput={event => setVerifyCommand(event.currentTarget.value)} placeholder="Verifier command" />
        <select class="panel-input" value={workspaceIsolation()} onInput={event => setWorkspaceIsolation(event.currentTarget.value as 'none' | 'temp_copy' | 'git_worktree')}>
          <option value="none">workspace: current</option>
          <option value="temp_copy">workspace: temp copy</option>
          <option value="git_worktree">workspace: git worktree</option>
        </select>
        <input class="panel-input" value={maxIterations()} onInput={event => setMaxIterations(event.currentTarget.value)} placeholder="Max iterations" />
        <input class="panel-input" value={maxTokens()} onInput={event => setMaxTokens(event.currentTarget.value)} placeholder="Max tokens" />
        <input class="panel-input" value={manualInterventionAfterFailures()} onInput={event => setManualInterventionAfterFailures(event.currentTarget.value)} placeholder="Manual intervention after failures" />
        <button class="send-button" disabled={!objective().trim()} onClick={() => void submitCreate()}>
          Create loop
        </button>
      </div>
      <div class="tool-list">
        <For each={props.loops}>
          {loop => (
            <button
              class="tool-card"
              classList={{ active: loop.metadata.loopId === props.activeLoopId }}
              onClick={() => void props.onSelect(loop.metadata.loopId)}
            >
              <span>{loop.metadata.title}</span>
              <strong>{loop.metadata.status} / {loop.metadata.trigger} / {loop.iterationCount} iter</strong>
              <small>{loop.metadata.objective}</small>
            </button>
          )}
        </For>
        <Show when={!props.loops.length}>
          <div class="empty-state small">No loops yet.</div>
        </Show>
      </div>
      <Show when={active()}>
        {loop => (
          <>
            <div class="button-row">
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onRun(loop().metadata.loopId)}>Run</button>
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onResume(loop().metadata.loopId)}>Resume</button>
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onPause(loop().metadata.loopId)}>Pause</button>
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onStop(loop().metadata.loopId)}>Stop</button>
              <button class="toolbar-button" disabled={props.running} onClick={() => void props.onRefresh()}>Refresh</button>
            </div>
            <Detail label="Loop ID" value={loop().metadata.loopId} />
            <Detail label="Workspace" value={loop().metadata.workspaceIsolation ?? 'none'} />
            <Detail label="Run cwd" value={loop().lastRun?.workspaceCwd ?? loop().metadata.currentWorkspaceCwd ?? 'none'} />
            <Detail label="Thread" value={loop().metadata.threadId ?? 'none'} />
            <Detail label="Updated" value={timeAgo(loop().metadata.updatedAtMs)} />
            <Show when={props.activeLoop}>
              {data => (
                <>
                  <div class="panel-heading subtle">
                    <span>State</span>
                    <strong>{data().metadata.status}</strong>
                  </div>
                  <pre class="json-view compact">{data().state}</pre>
                  <div class="panel-heading subtle">
                    <span>Last events</span>
                    <strong>{data().events.length}</strong>
                  </div>
                  <pre class="json-view compact">{JSON.stringify(data().events.slice(-6), null, 2)}</pre>
                </>
              )}
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}

function GatewayPanel(props: {
  status?: GatewayStatus
  command: string
  running: boolean
  onCommand(value: string): void
  onStart(): Promise<void>
  onRecover(): Promise<void>
  onStop(): Promise<void>
  onRefresh(): Promise<void>
  onSend(): Promise<void>
}) {
  const state = createMemo(() => props.status?.state)
  const worker = createMemo(() => props.status?.worker)
  const watchdog = createMemo(() => props.status?.doctor.watchdog)
  const channels = createMemo(() => props.status?.doctor.channels ?? state()?.connectedChannels ?? [])
  const mobileChannels = createMemo(() => channels().filter(channel => channel.kind !== 'local' && channel.kind !== 'mock'))
  const configuredMobileChannels = createMemo(() => mobileChannels().filter(channel => gatewayChannelReady(channel)))
  const pendingApprovalCount = createMemo(() => props.status?.pendingApprovals.length ?? 0)
  const staleRunCount = createMemo(() => props.status?.recentStaleRuns?.length ?? 0)
  const toolFailureCount = createMemo(() => props.status?.recentToolFailures?.length ?? 0)
  const heartbeatAgeMs = createMemo(() => watchdog()?.heartbeatAgeMs ?? (state()?.lastHeartbeatAtMs ? Date.now() - state()!.lastHeartbeatAtMs : undefined))
  const heartbeatStatus = createMemo(() => {
    if (watchdog()?.stale) return 'stale'
    if (watchdog()?.status === 'failed') return 'failed'
    if (worker()?.running) return 'live'
    return watchdog()?.status ?? state()?.status ?? 'stopped'
  })
  const gatewayTone = createMemo(() => gatewayToneFor(heartbeatStatus(), pendingApprovalCount(), staleRunCount(), toolFailureCount()))
  const gatewayHeadline = createMemo(() => {
    if (watchdog()?.recoverable) return 'Gateway can recover'
    if (worker()?.running) return 'Gateway worker running'
    if (heartbeatStatus() === 'stale') return 'Gateway heartbeat stale'
    if (!configuredMobileChannels().length) return 'Mobile channels need config'
    return 'Gateway ready for mobile control'
  })
  const gatewaySummary = createMemo(() => {
    const parts = [
      `${state()?.heartbeatCount ?? 0} heartbeat(s)`,
      `${configuredMobileChannels().length}/${mobileChannels().length} mobile channel(s) configured`,
      `${pendingApprovalCount()} pending approval(s)`,
      `${staleRunCount()} stale run(s)`,
    ]
    return parts.join(' / ')
  })
  const quickCommands = ['/status', '/goals', '/loops', '/usage', '/questions', '/background']
  return (
    <section class="panel-body" aria-label="Gateway and heartbeat dashboard" data-product-surface="gateway-dashboard">
      <div class="panel-heading">
        <span>Gateway</span>
        <strong>{props.status?.ok ? 'ready' : 'check required'}</strong>
      </div>
      <div class="gateway-command-center" aria-label="Gateway command center" data-product-surface="gateway-command-center">
        <div class="gateway-command-main">
          <div class="gateway-command-status">
            <span classList={{ active: gatewayTone() === 'ok', waiting: gatewayTone() === 'warn', danger: gatewayTone() === 'danger' }} />
            <strong>{gatewayHeadline()}</strong>
            <small>{worker()?.sessionId ?? state()?.status ?? 'no session'}</small>
          </div>
          <h2>{heartbeatStatus()} / {configuredMobileChannels().length} mobile channel(s)</h2>
          <p>{watchdog()?.message ?? gatewaySummary()}</p>
          <div class="gateway-command-actions">
            <button class="mission-action primary" disabled={props.running || Boolean(worker()?.running)} onClick={() => void props.onStart()}>
              <Icon name="play" />
              Start
            </button>
            <button class="mission-action" disabled={props.running || Boolean(worker()?.running) || !watchdog()?.recoverable} onClick={() => void props.onRecover()}>
              <Icon name="refresh" />
              Recover
            </button>
            <button class="mission-action" disabled={props.running || !worker()?.running} onClick={() => void props.onStop()}>
              <Icon name="stop" />
              Stop
            </button>
            <button class="mission-action" disabled={props.running} onClick={() => void props.onRefresh()}>
              <Icon name="check" />
              Refresh
            </button>
          </div>
        </div>

        <div class="gateway-health-grid" aria-label="Gateway heartbeat and mobile health">
          <RunStateCard
            label="Heartbeat"
            value={heartbeatStatus()}
            detail={heartbeatAgeMs() === undefined ? 'no heartbeat yet' : `${formatDuration(heartbeatAgeMs()!)} ago / ${state()?.heartbeatCount ?? 0} beat(s)`}
            tone={gatewayTone()}
          />
          <RunStateCard
            label="Mobile channels"
            value={`${configuredMobileChannels().length}/${mobileChannels().length}`}
            detail={mobileChannels().length ? mobileChannels().map(channel => `${channel.id}:${channel.status}`).join(', ') : 'local only'}
            tone={configuredMobileChannels().length || !mobileChannels().length ? 'ok' : 'warn'}
          />
          <RunStateCard
            label="Pending approvals"
            value={String(pendingApprovalCount())}
            detail={pendingApprovalCount() ? 'mobile approval available' : 'no pending decisions'}
            tone={pendingApprovalCount() ? 'warn' : 'ok'}
          />
          <RunStateCard
            label="Recovery risk"
            value={watchdog()?.recoverable ? 'recoverable' : staleRunCount() ? 'needs review' : 'clean'}
            detail={`${staleRunCount()} stale run(s), ${toolFailureCount()} failure signal(s)`}
            tone={watchdog()?.recoverable || staleRunCount() || toolFailureCount() ? 'warn' : 'ok'}
          />
        </div>

        <div class="gateway-mobile-command" aria-label="Gateway mobile command composer">
          <div class="gateway-command-input">
            <input class="panel-input" value={props.command} onInput={event => props.onCommand(event.currentTarget.value)} placeholder="/status" />
            <button class="send-button" disabled={!props.command.trim()} onClick={() => void props.onSend()}>Send</button>
          </div>
          <div class="gateway-quick-commands" aria-label="Gateway quick mobile commands">
            <For each={quickCommands}>
              {command => (
                <button type="button" onClick={() => props.onCommand(command)}>
                  {command}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
      <div class="metric-grid">
        <Metric label="State" value={state()?.status ?? 'stopped'} />
        <Metric label="Worker" value={worker()?.status ?? 'stopped'} />
        <Metric label="Watchdog" value={watchdog()?.status ?? 'unknown'} />
        <Metric label="Heartbeat" value={String(state()?.heartbeatCount ?? 0)} />
        <Metric label="Channels" value={String(channels().length)} />
        <Metric label="Approvals" value={String(props.status?.pendingApprovals.length ?? 0)} />
        <Metric label="Paired" value={String(props.status?.pairedUsers.length ?? state()?.pairedUsers?.length ?? 0)} />
        <Metric label="Runs" value={String(props.status?.recentRuns?.length ?? 0)} />
        <Metric label="Stale runs" value={String(props.status?.recentStaleRuns?.length ?? 0)} />
        <Metric label="Recovery" value={state()?.recoveredFrom ? 'restored' : 'clean'} />
      </div>
      <Show when={state()?.recoveredFrom}>
        {recovery => (
          <div class="empty-state small">
            Recovered {recovery().previousStatus} session {recovery().previousSessionId}; stale {recovery().staleMs}ms.
          </div>
        )}
      </Show>
      <Show when={watchdog()?.message}>
        {message => (
          <div classList={{ 'empty-state': true, small: true, danger: Boolean(watchdog()?.stale || watchdog()?.status === 'failed') }}>
            {message()}
          </div>
        )}
      </Show>
      <Show when={worker()?.lastError}>
        {lastError => <div class="empty-state small danger">Gateway worker failed: {lastError()}</div>}
      </Show>
      <Show when={worker()?.sessionId}>
        {sessionId => (
          <div class="empty-state small">
            Worker session {sessionId()} started {worker()?.startedAtMs ? timeLabel(worker()!.startedAtMs) : 'unknown'}.
          </div>
        )}
      </Show>
      <div class="panel-heading subtle">
        <span>Channels</span>
        <strong>{channels().filter(channel => channel.status === 'connected' || channel.status === 'configured').length} online/configured</strong>
      </div>
      <div class="tool-list">
        <For each={channels()}>
          {channel => (
            <article class="tool-card static">
              <span>{channel.id}</span>
              <strong>{channel.kind} / {channel.status}</strong>
              <small>{gatewayChannelDetail(channel)}</small>
              <small>{channel.message ?? 'ready'}</small>
            </article>
          )}
        </For>
      </div>
      <Show when={props.status?.pairedUsers.length}>
        <div class="panel-heading subtle">
          <span>Paired users</span>
          <strong>{props.status?.pairedUsers.length}</strong>
        </div>
        <div class="tool-list">
          <For each={(props.status?.pairedUsers ?? []).slice(0, 6)}>
            {user => (
              <article class="tool-card static">
                <span>{user.channelId} / {user.channelKind}</span>
                <strong>{user.userId}</strong>
                <small>last seen {timeLabel(user.lastSeenAtMs)}</small>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.status?.pendingApprovals.length}>
        <div class="panel-heading subtle">
          <span>Pending approvals</span>
          <strong>{props.status?.pendingApprovals.length}</strong>
        </div>
      </Show>
      <div class="tool-list">
        <For each={props.status?.pendingApprovals ?? []}>
          {approval => (
            <article class="tool-card static">
              <span>{approval.approvalId}</span>
              <strong>{approval.request.toolName} / {approval.request.risk}</strong>
              <small>{approval.threadId}</small>
            </article>
          )}
        </For>
      </div>
      <Show when={props.status?.recentRuns?.length}>
        <div class="panel-heading subtle">
          <span>Recent runs</span>
          <strong>{props.status?.recentRuns?.length}</strong>
        </div>
        <div class="tool-list">
          <For each={props.status?.recentRuns ?? []}>
            {run => (
              <article classList={{ 'tool-card': true, static: true, danger: run.status === 'failed' }}>
                <span>{run.status} / {formatDuration(run.durationMs ?? 0)}</span>
                <strong>{run.threadId}</strong>
                <small>{run.finalTextPreview ?? run.errorMessage ?? run.promptPreview ?? run.runId}</small>
                <small>{run.toolCallCount} tool(s), {run.failedToolResultCount} failed, {timeLabel(run.updatedAtMs)}</small>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.status?.recentStaleRuns?.length}>
        <div class="panel-heading subtle">
          <span>Stale runs</span>
          <strong>{props.status?.recentStaleRuns?.length}</strong>
        </div>
        <div class="tool-list">
          <For each={props.status?.recentStaleRuns ?? []}>
            {run => (
              <article class="tool-card static danger">
                <span>{formatDuration(run.ageMs)} active</span>
                <strong>{run.threadId}</strong>
                <small>{run.runId}</small>
                <small>threshold {formatDuration(run.staleAfterMs)}, last update {timeLabel(run.updatedAtMs)}</small>
              </article>
            )}
          </For>
        </div>
      </Show>
      <div class="panel-heading subtle">
        <span>Recent inbound</span>
        <strong>{props.status?.inbox.length ?? 0}</strong>
      </div>
      <div class="tool-list">
        <For each={(props.status?.inbox ?? []).slice(-4).reverse()}>
          {message => (
            <article class="tool-card static">
              <span>{message.channelId} / {message.userId}</span>
              <strong>{timeLabel(message.createdAtMs)}</strong>
              <small>{message.text}</small>
            </article>
          )}
        </For>
        <Show when={!props.status?.inbox.length}>
          <div class="empty-state small">No inbound gateway messages yet.</div>
        </Show>
      </div>
      <div class="panel-heading subtle">
        <span>Recent outbound</span>
        <strong>{props.status?.outbox.length ?? 0}</strong>
      </div>
      <div class="tool-list">
        <For each={(props.status?.outbox ?? []).slice(-6).reverse()}>
          {message => (
            <article class="tool-card static">
              <span>{message.channelId ?? 'local'} / {message.deliveryStatus ?? 'pending'}</span>
              <strong>{timeLabel(message.createdAtMs)}</strong>
              <small>{message.text}</small>
            </article>
          )}
        </For>
        <Show when={!props.status?.outbox.length}>
          <div class="empty-state small">No outbound gateway messages yet.</div>
        </Show>
      </div>
      <Show when={props.status?.recentToolFailures?.length}>
        <div class="panel-heading subtle">
          <span>Recent tool failures</span>
          <strong>{props.status?.recentToolFailures?.length}</strong>
        </div>
        <div class="tool-list">
          <For each={props.status?.recentToolFailures ?? []}>
            {failure => (
              <article class="tool-card static danger">
                <span>{failure.threadId}</span>
                <strong>{failure.toolName} / {failure.code}</strong>
                <small>{failure.category}: {failure.message ?? failure.contentPreview ?? 'No details'}</small>
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

function AcceptancePanel(props: {
  status?: AcceptanceStatus
  running: boolean
  onRefresh(): Promise<void>
  onRun(mode: 'dry_run' | 'quick'): Promise<void>
}) {
  const latest = createMemo(() => props.status?.latest)
  return (
    <section class="panel-body">
      <div class="panel-heading">
        <span>Acceptance Health</span>
        <strong>{acceptanceLabel(props.status)}</strong>
      </div>
      <div class="metric-grid">
        <Metric label="Runs" value={String(props.status?.runs.length ?? 0)} />
        <Metric label="Status" value={latest()?.status ?? props.status?.status ?? 'missing'} />
        <Metric label="Passed" value={String(latest()?.passedStepCount ?? 0)} />
        <Metric label="Failed" value={String(latest()?.failedStepCount ?? 0)} />
      </div>
      <div class="button-row">
        <button class="toolbar-button" onClick={() => void props.onRefresh()} disabled={props.running}>Refresh</button>
        <button class="toolbar-button" onClick={() => void props.onRun('dry_run')} disabled={props.running}>Plan dry-run</button>
        <button class="toolbar-button primary" onClick={() => void props.onRun('quick')} disabled={props.running}>
          {props.running ? 'Running...' : 'Run quick'}
        </button>
      </div>
      <Detail label="Root" value={props.status?.acceptanceRoot ?? 'not checked'} />
      <Detail label="Latest" value={latest()?.runId ?? 'none'} />
      <Detail label="Profile" value={latest()?.profile ?? 'none'} />
      <Detail label="Finished" value={latest()?.finishedAtMs ? timeLabel(latest()!.finishedAtMs) : 'none'} />
      <Detail label="Duration" value={formatDuration(latest()?.durationMs ?? 0)} />
      <Detail label="Report" value={latest()?.reportPath ?? 'none'} />

      <Show when={latest()?.failedSteps.length}>
        <div class="panel-heading subtle">
          <span>Failed gates</span>
          <strong>{latest()?.failedSteps.length}</strong>
        </div>
        <div class="chip-row">
          <For each={latest()?.failedSteps ?? []}>
            {step => <button type="button" onClick={() => showToast(step)}>{step}</button>}
          </For>
        </div>
      </Show>

      <div class="panel-heading subtle">
        <span>Latest steps</span>
        <strong>{latest()?.selectedStepCount ?? 0}/{latest()?.totalStepCount ?? 0}</strong>
      </div>
      <div class="tool-list">
        <For each={latest()?.steps ?? []}>
          {step => (
            <article class="tool-card static">
              <span>{step.id}</span>
              <strong>{step.status} / {formatDuration(step.durationMs)}</strong>
              <small>{step.command}</small>
            </article>
          )}
        </For>
        <Show when={!latest()?.steps.length}>
          <div class="empty-state small">No acceptance smoke report has been recorded yet.</div>
        </Show>
      </div>

      <div class="panel-heading subtle">
        <span>Recent runs</span>
        <strong>{props.status?.runs.length ?? 0}</strong>
      </div>
      <div class="tool-list">
        <For each={props.status?.runs ?? []}>
          {run => (
            <article class="tool-card static">
              <span>{run.runId}</span>
              <strong>{run.status} / {run.profile}</strong>
              <small>{run.passedStepCount} passed, {run.failedStepCount} failed, finished {run.finishedAtMs ? timeLabel(run.finishedAtMs) : 'unknown'}</small>
            </article>
          )}
        </For>
      </div>
      <Show when={props.status?.error}>
        {error => <div class="empty-state small">{error()}</div>}
      </Show>
    </section>
  )
}

function FilesPanel(props: {
  files?: FileListResponse
  onNavigate(path?: string): Promise<void>
  onSelectFile(path: string): void
}) {
  return (
    <section class="panel-body">
      <div class="panel-heading">
        <span>Files</span>
        <strong>{props.files?.path || '.'}</strong>
      </div>
      <div class="file-toolbar">
        <button class="toolbar-button" onClick={() => void props.onNavigate('')}>
          Root
        </button>
        <button class="toolbar-button" disabled={!props.files?.parentPath} onClick={() => void props.onNavigate(props.files?.parentPath)}>
          Up
        </button>
        <button class="toolbar-button" onClick={() => void props.onNavigate(props.files?.path ?? '')}>
          Refresh
        </button>
      </div>
      <div class="file-list">
        <For each={props.files?.entries ?? []}>
          {entry => (
            <button
              class="file-row"
              data-kind={entry.kind}
              onClick={() => entry.kind === 'directory' ? void props.onNavigate(entry.relativePath) : props.onSelectFile(entry.relativePath)}
            >
              <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} />
              <span>{entry.name}</span>
              <small>{entry.kind === 'directory' ? 'folder' : formatBytes(entry.size ?? 0)}</small>
            </button>
          )}
        </For>
        <Show when={!props.files?.entries?.length}>
          <div class="empty-state small">{props.files?.error ?? 'No files in this directory.'}</div>
        </Show>
      </div>
      <Show when={props.files?.truncated}>
        <div class="empty-state small">Showing first 250 entries.</div>
      </Show>
    </section>
  )
}

function SettingsPanel(props: {
  settings?: SettingsReport
  doctor?: DoctorReport
  activeThreadId?: string
  onSaveModel(input: {
    provider: string
    modelName: string
    providerName: string
    baseURL: string
    protocol: string
    authType: string
    apiKeyEnv: string
  }): Promise<void>
  onSaveThreadModel(input: {
    provider: string
    modelName: string
  }): Promise<void>
  onSaveRuntime(input: {
    approvalPolicy: string
    sandboxMode: string
    approvalsReviewer: string
    trustedTools: string
    gatewayEnabled: boolean
    heartbeatIntervalMs: string
    progressHeartbeatIntervalMs: string
    wakeHeartbeatIntervalMs: string
    allowUsers: string
    pairingSecretEnv: string
  }): Promise<void>
}) {
  const [provider, setProvider] = createSignal('')
  const [modelName, setModelName] = createSignal('')
  const [providerName, setProviderName] = createSignal('')
  const [baseURL, setBaseURL] = createSignal('')
  const [protocol, setProtocol] = createSignal('openai-chat-completions')
  const [authType, setAuthType] = createSignal('api-key')
  const [apiKeyEnv, setApiKeyEnv] = createSignal('')
  const [approvalPolicy, setApprovalPolicy] = createSignal('on-request')
  const [sandboxMode, setSandboxMode] = createSignal('workspace-write')
  const [approvalsReviewer, setApprovalsReviewer] = createSignal('user')
  const [trustedTools, setTrustedTools] = createSignal('')
  const [gatewayEnabled, setGatewayEnabled] = createSignal(true)
  const [heartbeatIntervalMs, setHeartbeatIntervalMs] = createSignal('60000')
  const [progressHeartbeatIntervalMs, setProgressHeartbeatIntervalMs] = createSignal('30000')
  const [wakeHeartbeatIntervalMs, setWakeHeartbeatIntervalMs] = createSignal('300000')
  const [allowUsers, setAllowUsers] = createSignal('')
  const [pairingSecretEnv, setPairingSecretEnv] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  const [savingRuntime, setSavingRuntime] = createSignal(false)
  const catalog = createMemo(() => props.settings?.modelSettings?.catalog ?? [])
  const selectedProvider = createMemo(() => catalog().find(item => item.id === provider()))
  const selectedCapabilities = createMemo(() => selectedProvider()?.capabilities ?? props.settings?.modelSettings?.active.capabilities)
  const selectedRegion = createMemo(() => providerRegionLabel(provider()))
  const selectedContextWindow = createMemo(() => contextWindowLabel(selectedCapabilities()))
  const selectedAuthStatus = createMemo(() => authStatusLabel(authType(), apiKeyEnv(), selectedProvider()))
  const selectedHealth = createMemo(() => selectedProvider()?.error ? 'needs attention' : selectedProvider()?.configured || authType() === 'none' ? 'ready' : 'env required')

  createEffect(() => {
    const active = props.settings?.modelSettings?.active
    if (!active) return
    setProvider(active.provider)
    setProviderName(active.name)
    setModelName(active.model)
    setBaseURL(active.baseURL)
    setProtocol(active.protocol)
    setAuthType(active.authType === 'none' ? 'none' : 'api-key')
    setApiKeyEnv(active.authEnvKeys[0] ?? defaultApiKeyEnv(active.provider))
    const permissions = props.settings?.permissions
    setApprovalPolicy(permissions?.approvalPolicy ?? 'on-request')
    setSandboxMode(permissions?.sandboxMode ?? 'workspace-write')
    setApprovalsReviewer(permissions?.approvalsReviewer ?? 'user')
    setTrustedTools((permissions?.trustedTools ?? []).join(', '))
    const gateway = props.settings?.gateway
    setGatewayEnabled(gateway?.enabled ?? true)
    setHeartbeatIntervalMs(String(gateway?.heartbeatIntervalMs ?? 60000))
    setProgressHeartbeatIntervalMs(String(gateway?.progressHeartbeatIntervalMs ?? 30000))
    setWakeHeartbeatIntervalMs(String(gateway?.wakeHeartbeatIntervalMs ?? 300000))
    setAllowUsers((gateway?.allowUsers ?? []).join(', '))
    setPairingSecretEnv(gateway?.pairingSecretEnv ?? '')
  })

  const chooseProvider = (providerId: string) => {
    const item = catalog().find(entry => entry.id === providerId)
    setProvider(providerId)
    setProviderName(item?.name ?? providerId)
    setModelName(item?.model && item.model !== 'unknown' ? item.model : '')
    setBaseURL(item?.baseURL ?? '')
    setProtocol(item?.protocol ?? 'openai-chat-completions')
    setAuthType(item?.authType === 'none' ? 'none' : 'api-key')
    setApiKeyEnv(item?.authEnvKeys?.[0] ?? defaultApiKeyEnv(providerId))
  }

  const save = async () => {
    if (!provider().trim() || saving()) return
    setSaving(true)
    try {
      await props.onSaveModel({
        provider: provider().trim(),
        modelName: modelName().trim(),
        providerName: providerName().trim(),
        baseURL: baseURL().trim(),
        protocol: protocol(),
        authType: authType(),
        apiKeyEnv: apiKeyEnv().trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  const saveRuntime = async () => {
    if (savingRuntime()) return
    setSavingRuntime(true)
    try {
      await props.onSaveRuntime({
        approvalPolicy: approvalPolicy(),
        sandboxMode: sandboxMode(),
        approvalsReviewer: approvalsReviewer(),
        trustedTools: trustedTools(),
        gatewayEnabled: gatewayEnabled(),
        heartbeatIntervalMs: heartbeatIntervalMs(),
        progressHeartbeatIntervalMs: progressHeartbeatIntervalMs(),
        wakeHeartbeatIntervalMs: wakeHeartbeatIntervalMs(),
        allowUsers: allowUsers(),
        pairingSecretEnv: pairingSecretEnv(),
      })
    } finally {
      setSavingRuntime(false)
    }
  }

  return (
    <section class="panel-body" aria-label="Model provider and runtime settings" data-product-surface="model-provider-settings">
      <div class="panel-heading">
        <span>Settings</span>
        <strong>{props.settings?.configPath ?? 'default config'}</strong>
      </div>
      <div class="model-selector-card" aria-label="Product model selector" data-product-surface="product-model-selector">
        <div class="model-selector-header">
          <div>
            <span>Active provider</span>
            <h2>{providerName() || selectedProvider()?.name || provider() || 'No provider selected'}</h2>
            <p>{baseURL() || selectedProvider()?.baseURL || 'Local fake provider or workspace default'}</p>
          </div>
          <div class="model-ready-chip" data-tone={selectedProvider()?.error ? 'warn' : 'ok'}>
            <Icon name={selectedProvider()?.error ? 'warning' : 'check'} />
            {selectedHealth()}
          </div>
        </div>
        <div class="model-identity-grid">
          <div class="model-identity">
            <span>Provider / model</span>
            <strong>{provider() || 'provider'} / {modelName() || selectedProvider()?.defaultModel || 'model'}</strong>
          </div>
          <div class="model-identity">
            <span>Context window</span>
            <strong>{selectedContextWindow()}</strong>
          </div>
          <div class="model-identity">
            <span>API key status</span>
            <strong>{selectedAuthStatus()}</strong>
          </div>
          <div class="model-identity">
            <span>China/global routing</span>
            <strong>{selectedRegion()}</strong>
          </div>
        </div>
        <div class="model-capability-grid" aria-label="Capability badges">
          <For each={capabilityBadges(selectedCapabilities())}>
            {badge => (
              <div class="capability-badge" classList={{ enabled: badge.enabled }}>
                <span>{badge.label}</span>
                <strong>{badge.value}</strong>
              </div>
            )}
          </For>
        </div>
        <div class="provider-option-grid" aria-label="Provider catalog">
          <For each={catalog()}>
            {item => (
              <button
                type="button"
                class="provider-option"
                classList={{ active: item.id === provider(), warning: Boolean(item.error) }}
                onClick={() => chooseProvider(item.id)}
              >
                <div class="provider-option-top">
                  <strong>{item.name}</strong>
                  <span>{item.configured ? 'configured' : item.authType === 'none' ? 'no key' : 'setup'}</span>
                </div>
                <small>{item.model && item.model !== 'unknown' ? item.model : item.defaultModel}</small>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="metric-grid">
        <Metric label="Doctor" value={props.doctor?.ok ? 'ok' : 'check'} />
        <Metric label="Default model" value={modelLabel({ threadId: '', title: '', cwd: '', updatedAtMs: 0, model: props.settings?.model }) || modelLabelFromDoctor(props.doctor)} />
        <Metric label="Providers" value={String(catalog().length)} />
        <Metric label="Approvals" value={String(props.settings?.pendingApprovalCount ?? 0)} />
      </div>
      <div class="panel-form">
        <label class="field-label">
          Provider
          <select class="panel-input" value={provider()} onInput={event => chooseProvider(event.currentTarget.value)}>
            <For each={catalog()}>
              {item => <option value={item.id}>{item.name} ({item.id})</option>}
            </For>
          </select>
        </label>
        <label class="field-label">
          Model
          <input class="panel-input" value={modelName()} onInput={event => setModelName(event.currentTarget.value)} placeholder="model name" />
        </label>
        <label class="field-label">
          Provider name
          <input class="panel-input" value={providerName()} onInput={event => setProviderName(event.currentTarget.value)} placeholder="provider display name" />
        </label>
        <label class="field-label">
          Base URL
          <input class="panel-input" value={baseURL()} onInput={event => setBaseURL(event.currentTarget.value)} placeholder="https://api.example.com/v1" />
        </label>
        <div class="form-grid two">
          <label class="field-label">
            Protocol
            <select class="panel-input" value={protocol()} onInput={event => setProtocol(event.currentTarget.value)}>
              <option value="openai-chat-completions">chat completions</option>
              <option value="openai-responses">responses</option>
            </select>
          </label>
          <label class="field-label">
            Auth
            <select class="panel-input" value={authType()} onInput={event => setAuthType(event.currentTarget.value)}>
              <option value="api-key">api key env</option>
              <option value="none">none</option>
            </select>
          </label>
        </div>
        <label class="field-label">
          API key env
          <input class="panel-input" value={apiKeyEnv()} onInput={event => setApiKeyEnv(event.currentTarget.value)} placeholder="OPENAI_API_KEY" />
        </label>
        <div class="button-row">
          <button type="button" class="primary-button" disabled={saving()} onClick={() => void save()}>
            {saving() ? 'Saving' : 'Save model'}
          </button>
          <button
            type="button"
            class="secondary-button"
            disabled={saving() || !props.activeThreadId}
            onClick={() => void props.onSaveThreadModel({ provider: provider().trim(), modelName: modelName().trim() })}
          >
            Use for current thread
          </button>
        </div>
      </div>
      <Detail label="Current thread" value={props.activeThreadId ? `model can be updated for ${props.activeThreadId}` : 'create or select a thread to apply this model'} />
      <div class="panel-form">
        <div class="panel-heading compact">
          <span>Runtime policy</span>
          <strong>{props.settings?.permissions?.sandboxMode ?? 'default'}</strong>
        </div>
        <div class="form-grid two">
          <label class="field-label">
            Approval policy
            <select class="panel-input" value={approvalPolicy()} onInput={event => setApprovalPolicy(event.currentTarget.value)}>
              <option value="unless-trusted">unless trusted</option>
              <option value="on-failure">on failure</option>
              <option value="on-request">on request</option>
              <option value="granular">granular</option>
              <option value="never">never</option>
            </select>
          </label>
          <label class="field-label">
            Sandbox
            <select class="panel-input" value={sandboxMode()} onInput={event => setSandboxMode(event.currentTarget.value)}>
              <option value="read-only">read only</option>
              <option value="workspace-write">workspace write</option>
              <option value="danger-full-access">full access</option>
            </select>
          </label>
        </div>
        <div class="form-grid two">
          <label class="field-label">
            Reviewer
            <select class="panel-input" value={approvalsReviewer()} onInput={event => setApprovalsReviewer(event.currentTarget.value)}>
              <option value="user">user</option>
              <option value="auto_review">auto review</option>
            </select>
          </label>
          <label class="field-label">
            Trusted tools
            <input class="panel-input" value={trustedTools()} onInput={event => setTrustedTools(event.currentTarget.value)} placeholder="file_read, glob, grep" />
          </label>
        </div>
        <label class="field-label inline-check">
          <input type="checkbox" checked={gatewayEnabled()} onInput={event => setGatewayEnabled(event.currentTarget.checked)} />
          Gateway enabled
        </label>
        <div class="form-grid three">
          <label class="field-label">
            Heartbeat ms
            <input class="panel-input" value={heartbeatIntervalMs()} onInput={event => setHeartbeatIntervalMs(event.currentTarget.value)} />
          </label>
          <label class="field-label">
            Progress ms
            <input class="panel-input" value={progressHeartbeatIntervalMs()} onInput={event => setProgressHeartbeatIntervalMs(event.currentTarget.value)} />
          </label>
          <label class="field-label">
            Wake ms
            <input class="panel-input" value={wakeHeartbeatIntervalMs()} onInput={event => setWakeHeartbeatIntervalMs(event.currentTarget.value)} />
          </label>
        </div>
        <div class="form-grid two">
          <label class="field-label">
            Gateway users
            <input class="panel-input" value={allowUsers()} onInput={event => setAllowUsers(event.currentTarget.value)} placeholder="local-user, telegram/1234" />
          </label>
          <label class="field-label">
            Pairing env
            <input class="panel-input" value={pairingSecretEnv()} onInput={event => setPairingSecretEnv(event.currentTarget.value)} placeholder="PANDO_GATEWAY_PAIRING_SECRET" />
          </label>
        </div>
        <button type="button" class="secondary-button" disabled={savingRuntime()} onClick={() => void saveRuntime()}>
          {savingRuntime() ? 'Saving' : 'Save runtime'}
        </button>
      </div>
      <Show when={selectedProvider()?.error}>
        {error => <div class="empty-state small danger">{error()}</div>}
      </Show>
      <details class="config-audit">
        <summary>Configuration audit</summary>
        <pre class="json-view">{JSON.stringify(props.settings?.config ?? {}, null, 2)}</pre>
      </details>
    </section>
  )
}

function CommandPalette(props: {
  threads: ThreadSummary[]
  activeThreadId?: string
  queryTitle: string
  onClose(): void
  onSelectThread(threadId: string): void
  onAction(action: string): void
}) {
  const [query, setQuery] = createSignal('')
  const commands = createMemo(() => [
    { id: 'new-session', label: 'New session', meta: 'Create a fresh thread' },
    { id: 'refresh', label: 'Refresh runtime', meta: 'Reload sessions, MCP, GUI, settings' },
    { id: 'files', label: 'Open files', meta: 'Browse workspace files' },
    { id: 'tools', label: 'Open tools', meta: 'Inspect MCP and tool events' },
    { id: 'thread', label: 'Open thread', meta: 'Rename, branch, and export the active thread' },
    { id: 'goal', label: 'Open goal', meta: 'Inspect objective progress, evidence, blockers, and resume controls' },
    { id: 'loops', label: 'Open loops', meta: 'Create, run, pause, and inspect Loop Engineering runs' },
    { id: 'gateway', label: 'Open gateway', meta: 'Inspect heartbeat, channels, approvals, and messages' },
    { id: 'acceptance', label: 'Open health', meta: 'Inspect short acceptance gates and latest report evidence' },
    { id: 'context', label: 'Open context', meta: 'Inspect context and compaction state' },
    { id: 'settings', label: 'Open settings', meta: 'Inspect model, permissions, config' },
  ])
  const filteredThreads = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (!needle) return props.threads.slice(0, 8)
    return props.threads.filter(thread => `${thread.metadata.title} ${thread.metadata.threadId}`.toLowerCase().includes(needle)).slice(0, 8)
  })
  const filteredCommands = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (!needle) return commands()
    return commands().filter(command => `${command.label} ${command.meta}`.toLowerCase().includes(needle))
  })

  return (
    <div class="command-backdrop" onMouseDown={event => event.currentTarget === event.target && props.onClose()}>
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="Command search">
        <div class="command-input">
          <Icon name="search" />
          <input
            autofocus
            value={query()}
            placeholder={`Search ${props.queryTitle}...`}
            onInput={event => setQuery(event.currentTarget.value)}
            onKeyDown={event => event.key === 'Escape' && props.onClose()}
          />
        </div>
        <div class="command-section">
          <span>Commands</span>
          <For each={filteredCommands()}>
            {command => (
              <button onClick={() => props.onAction(command.id)}>
                <strong>{command.label}</strong>
                <small>{command.meta}</small>
              </button>
            )}
          </For>
        </div>
        <div class="command-section">
          <span>Sessions</span>
          <For each={filteredThreads()}>
            {thread => (
              <button classList={{ active: thread.metadata.threadId === props.activeThreadId }} onClick={() => props.onSelectThread(thread.metadata.threadId)}>
                <strong>{thread.metadata.title}</strong>
                <small>{modelLabel(thread.metadata)} / {thread.messageCount} msg / {thread.eventCount} evt</small>
              </button>
            )}
          </For>
        </div>
      </section>
    </div>
  )
}

function PlaceholderPanel(props: { title: string; copy: string }) {
  return (
    <section class="placeholder-panel">
      <div class="placeholder-icon">
        <Icon name="spark" />
      </div>
      <h3>{props.title}</h3>
      <p>{props.copy}</p>
    </section>
  )
}

function StatusPill(props: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div class="status-pill" data-tone={props.tone}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function Detail(props: { label: string; value: string }) {
  return (
    <div class="detail-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div class="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function RunStateCard(props: { label: string; value: string; detail: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <article class="run-state-card" data-tone={props.tone ?? 'neutral'}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  )
}

function Icon(props: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={iconPath(props.name)} />
    </svg>
  )
}

function buildTimelineRows(agentEvents: AgentEvent[], messages: ThreadData['messages']): TimelineRowData[] {
  if (agentEvents.length) {
    const rows: TimelineRowData[] = []
    const completedTurnIds = new Set(
      agentEvents
        .filter(event => event.type === 'agent_message_completed' && event.turnId)
        .map(event => String(event.turnId)),
    )
    const streamingRows = new Map<string, TimelineRowData>()

    for (const event of agentEvents) {
      if (event.type === 'agent_message_delta' && event.turnId && !completedTurnIds.has(String(event.turnId))) {
        const turnId = String(event.turnId)
        const existing = streamingRows.get(turnId)
        if (existing) {
          existing.content += event.delta ?? ''
          existing.time = event.createdAtMs ? timeLabel(event.createdAtMs) : existing.time
          existing.event = event
        } else {
          const row: TimelineRowData = {
            id: `stream:${turnId}`,
            kind: 'assistant',
            title: 'Assistant',
            content: event.delta ?? '',
            time: event.createdAtMs ? timeLabel(event.createdAtMs) : '',
            event,
            streaming: true,
          }
          streamingRows.set(turnId, row)
          rows.push(row)
        }
        continue
      }

      if (!isRenderableEvent(event, agentEvents)) continue
      rows.push({
        id: event.id ?? `${event.type}:${rows.length}`,
        kind: rowKind(event),
        title: rowTitle(event),
        content: rowContent(event),
        meta: rowMeta(event),
        time: event.createdAtMs ? timeLabel(event.createdAtMs) : '',
        event,
      })
    }

    if (rows.length) return rows
  }
  return messages.map((message, index) => ({
    id: `message:${index}`,
    kind: message.role === 'tool' ? 'tool' : message.role,
    title: message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'Tool result',
    content: message.content || '(empty)',
    time: '',
  }))
}

function rowKind(event: AgentEvent): TimelineRowData['kind'] {
  if (event.type.includes('approval')) return 'approval'
  if (event.ok === false || event.type.includes('failed')) return 'error'
  if (event.type.includes('tool') || event.type.includes('gui_action')) return 'tool'
  if (event.type.includes('context') || event.type.includes('compaction')) return 'context'
  if (event.type.includes('agent_message')) return 'assistant'
  if (event.type === 'turn_started') return 'user'
  return 'system'
}

function rowTitle(event: AgentEvent): string {
  switch (event.type) {
    case 'turn_started':
      return 'User'
    case 'turn_completed':
      return 'Turn completed'
    case 'turn_failed':
      return 'Run failed'
    case 'agent_message_completed':
      return 'Assistant'
    case 'context_built':
      return 'Context built'
    case 'tool_call_started':
      return `Tool started: ${event.toolName ?? 'tool'}`
    case 'tool_call_completed':
      return event.ok === false ? `Tool failed: ${event.toolName ?? 'tool'}` : `Tool completed: ${event.toolName ?? 'tool'}`
    case 'approval_requested':
    case 'approval_pending':
      return `Permission request: ${event.toolName ?? 'tool'}`
    case 'approval_completed':
      return event.approved ? 'Permission approved' : 'Permission rejected'
    case 'compaction_started':
      return 'Compaction started'
    case 'compaction_completed':
      return 'Compaction completed'
    case 'compaction_failed':
      return 'Compaction failed'
    case 'gui_action_started':
      return `GUI action: ${event.action ?? 'action'}`
    case 'gui_action_completed':
      return `GUI completed: ${event.method ?? 'method'}`
    case 'gui_action_failed':
      return 'GUI failed'
    case 'gui_action_verified':
      return 'GUI verified'
    case 'mcp_server_failed':
      return `MCP failed: ${event.serverName ?? 'server'}`
    default:
      return event.type.replaceAll('_', ' ')
  }
}

function rowContent(event: AgentEvent): string {
  switch (event.type) {
    case 'turn_started':
      return event.promptPreview ?? '(empty prompt)'
    case 'agent_message_completed':
      return event.textPreview ?? '(empty response)'
    case 'turn_completed':
      return event.finalTextPreview || `Completed in ${event.durationMs ?? 0}ms.`
    case 'turn_failed':
      return event.message ?? 'The turn failed.'
    case 'context_built':
      return contextSummary(event)
    case 'tool_call_started':
      return event.input ? formatInlineJson(event.input, 320) : 'Tool input is empty.'
    case 'tool_call_completed':
      return toolEventPreview(event)
    case 'approval_requested':
    case 'approval_pending':
      return String(event.reason ?? 'Waiting for approval.')
    case 'approval_completed':
      return event.reason || (event.approved ? 'Approved.' : 'Rejected.')
    case 'compaction_started':
      return `Window ${event.windowId ?? 'unknown'} started. Reason: ${event.reason ?? 'manual'}.`
    case 'compaction_completed':
      return `Covered ${event.coveredMessageCount ?? 0} message(s), retained ${event.retainedMessageCount ?? 0}, summary ${event.summaryChars ?? 0} chars.`
    case 'compaction_failed':
      return event.message ?? 'Compaction failed.'
    case 'gui_action_started':
      return [event.action, event.target].filter(Boolean).join(' / ') || 'GUI action started.'
    case 'gui_action_completed':
      return `${event.message ?? 'GUI action completed.'}${event.fallbackUsed ? ' Visual fallback used.' : ''}`
    case 'gui_action_failed':
      return event.message ?? 'GUI action failed.'
    case 'gui_action_verified':
      return event.message ?? (event.ok ? 'Verification passed.' : 'Verification failed.')
    case 'mcp_server_failed':
      return event.message ?? 'MCP server failed.'
    default:
      return event.message ?? event.contentPreview ?? event.textPreview ?? event.finalTextPreview ?? event.promptPreview ?? event.delta ?? formatInlineJson(event, 320)
  }
}

function rowMeta(event: AgentEvent): string | undefined {
  if (event.type === 'context_built') return contextLabel(event)
  const failure = failureLabel(event)
  if (failure) return failure
  if (event.toolName) return event.toolName
  if (event.risk) return event.risk
  if (event.provider || event.model) return [event.provider, event.model].filter(Boolean).join('/')
  return undefined
}

function rowIcon(kind: TimelineRowData['kind']): string {
  switch (kind) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'spark'
    case 'tool':
      return 'wrench'
    case 'approval':
      return 'shield'
    case 'context':
      return 'layers'
    case 'error':
      return 'warning'
    default:
      return 'dot'
  }
}

function activityMatches(row: TimelineRowData, filter: ActivityFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'errors') return row.kind === 'error'
  if (filter === 'approvals') return row.kind === 'approval'
  if (filter === 'gui') return row.event?.type.includes('gui_action') === true || Boolean(row.event?.screenshotPath)
  if (filter === 'tools') return row.kind === 'tool' && !activityMatches(row, 'gui')
  if (filter === 'runs') {
    const type = row.event?.type ?? ''
    return type.includes('turn_') || type.includes('task_') || type.includes('loop_') || row.streaming === true
  }
  return false
}

function activityStatus(row: TimelineRowData): string {
  if (row.streaming) return 'streaming'
  if (row.kind === 'error') return 'failed'
  if (row.kind === 'approval') return 'approval'
  if (row.event?.type.includes('started')) return 'started'
  if (row.event?.type.includes('completed')) return 'completed'
  if (row.event?.type.includes('verified')) return 'verified'
  return activityFilterLabel(row)
}

function activityFilterLabel(row: TimelineRowData): string {
  if (activityMatches(row, 'gui')) return 'gui'
  if (activityMatches(row, 'tools')) return 'tool'
  if (activityMatches(row, 'runs')) return 'run'
  if (activityMatches(row, 'approvals')) return 'approval'
  if (activityMatches(row, 'errors')) return 'error'
  return row.kind
}

function appendEvent(event: AgentEvent) {
  let shouldSelect = false
  setEvents(current => {
    if (event.id && current.some(item => item.id === event.id)) return current
    const next = [...current, event]
    shouldSelect = isRenderableEvent(event, next)
    return next
  })
  if (shouldSelect) setSelectedEvent(event)
}

async function refreshDoctor() {
  setDoctor(await getJson<DoctorReport>('/api/doctor'))
}

async function refreshSystemStatus() {
  const [doctorReport, mcp, gui, appSettings, gateway, acceptance, tools, tasks, questionData] = await Promise.all([
    getJson<DoctorReport>('/api/doctor'),
    getJson<McpReport[]>('/api/mcp'),
    getJson<GuiReport>('/api/gui'),
    getJson<SettingsReport>('/api/settings'),
    getJson<GatewayStatus>('/api/gateway'),
    getJson<AcceptanceStatus>('/api/acceptance'),
    getJson<ToolCatalogResponse>('/api/tools'),
    getJson<TaskListResponse>('/api/tasks'),
    getJson<QuestionListResponse>('/api/questions'),
  ])
  setDoctor(doctorReport)
  setMcpReport(mcp)
  setGuiReport(gui)
  setSettings(appSettings)
  setGatewayStatus(gateway)
  setAcceptanceStatus(acceptance)
  setToolCatalog(tools)
  setTaskStatus(tasks)
  setQuestions(questionData)
}

async function refreshTools() {
  setToolCatalog(await getJson<ToolCatalogResponse>('/api/tools'))
}

async function refreshTasks() {
  setTaskStatus(await getJson<TaskListResponse>('/api/tasks'))
}

async function refreshQuestions() {
  setQuestions(await getJson<QuestionListResponse>('/api/questions'))
}

async function stopTaskFromPanel(taskId: string) {
  if (taskWorking()) return
  setTaskWorking(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; task?: TaskView }>(
      `/api/tasks/${encodeURIComponent(taskId)}/stop`,
      { reason: 'Stopped from Web Tools panel.' },
    )
    if (!result.ok) {
      showToast(result.error ?? 'Task stop failed')
      return
    }
    await refreshTasks()
    showToast(`Task stopped: ${taskId}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setTaskWorking(false)
  }
}

async function answerQuestionFromPanel(questionId: string, answer: string) {
  if (questionWorking()) return
  setQuestionWorking(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; question?: QuestionView }>(
      `/api/questions/${encodeURIComponent(questionId)}/answer`,
      { answer, answeredBy: 'web' },
    )
    if (!result.ok) {
      showToast(result.error ?? 'Question answer failed')
      return
    }
    await refreshQuestions()
    showToast(`Question answered: ${questionId}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setQuestionWorking(false)
  }
}

async function saveModelSettings(input: {
  provider: string
  modelName: string
  providerName: string
  baseURL: string
  protocol: string
  authType: string
  apiKeyEnv: string
}) {
  const result = await postJson<SettingsReport & { error?: string }>('/api/settings/model', input)
  if (!result.ok) {
    showToast(result.error ?? 'Model settings failed')
    return
  }
  setSettings(result)
  await refreshDoctor()
  showToast(`Default model saved: ${result.model?.provider}/${result.model?.name}`)
}

async function saveRuntimeSettings(input: {
  approvalPolicy: string
  sandboxMode: string
  approvalsReviewer: string
  trustedTools: string
  gatewayEnabled: boolean
  heartbeatIntervalMs: string
  progressHeartbeatIntervalMs: string
  wakeHeartbeatIntervalMs: string
  allowUsers: string
  pairingSecretEnv: string
}) {
  const result = await postJson<SettingsReport & { error?: string }>('/api/settings/runtime', input)
  if (!result.ok) {
    showToast(result.error ?? 'Runtime settings failed')
    return
  }
  setSettings(result)
  await refreshDoctor()
  await refreshGateway()
  showToast('Runtime settings saved')
}

async function saveThreadModel(input: { provider: string; modelName: string }) {
  const threadId = activeThreadId()
  if (!threadId) {
    showToast('Create or select a thread first')
    return
  }
  const result = await postJson<{ ok: boolean; error?: string; metadata?: ThreadMetadata }>(
    `/api/threads/${encodeURIComponent(threadId)}/model`,
    input,
  )
  if (!result.ok || !result.metadata) {
    showToast(result.error ?? 'Thread model update failed')
    return
  }
  await refreshThreads()
  await loadThread(threadId)
  showToast(`Thread model saved: ${modelLabel(result.metadata)}`)
}

async function refreshFiles(path = filePath()) {
  const data = await getJson<FileListResponse>(`/api/files?path=${encodeURIComponent(path)}`)
  if (!data.ok) {
    setFiles(data)
    showToast(data.error ?? 'File list failed')
    return
  }
  setFilePath(data.path)
  setFiles(data)
}

async function refreshThreads() {
  const data = await getJson<ThreadSummary[]>('/api/threads')
  setThreads(data)
  if (!activeThreadId() && data[0]) setActiveThreadId(data[0].metadata.threadId)
}

async function refreshGoals() {
  const data = await getJson<GoalSummary[]>('/api/goals')
  setGoals(data)
  const active = data.find(goal => goal.metadata.status === 'active') ?? data[0]
  if (!activeGoalId() && active) {
    setActiveGoalId(active.metadata.goalId)
    await loadGoal(active.metadata.goalId)
  } else if (activeGoalId()) {
    await loadGoal(activeGoalId()!)
  }
}

async function loadGoal(goalId: string) {
  setActiveGoalId(goalId)
  const data = await getJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}`)
  setGoalData(data)
}

async function createGoalFromPanel(input: { title: string; objective: string; requirements: string[] }) {
  const result = await postJson<{ ok: boolean; error?: string; summary?: GoalSummary }>('/api/goals', input)
  if (!result.ok || !result.summary) {
    showToast(result.error ?? 'Goal create failed')
    return
  }
  setActiveGoalId(result.summary.metadata.goalId)
  await refreshGoals()
  showToast(`Goal created: ${result.summary.metadata.goalId}`)
}

async function runGoalAction(goalId: string, action: 'resume' | 'continue' | 'pause' | 'block' | 'complete', reason?: string) {
  if (goalWorking()) return
  setGoalWorking(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; summary?: GoalSummary }>(
      `/api/goals/${encodeURIComponent(goalId)}/${action}`,
      reason ? { reason } : {},
    )
    if (!result.ok) {
      showToast(result.error ?? `Goal ${action} failed`)
      return
    }
    await refreshGoals()
    showToast(`Goal ${action}: ${result.summary?.metadata.status ?? 'ok'}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setGoalWorking(false)
  }
}

async function refreshLoops() {
  const data = await getJson<LoopSummary[]>('/api/loops')
  setLoops(data)
  if (!activeLoopId() && data[0]) {
    setActiveLoopId(data[0].metadata.loopId)
    await loadLoop(data[0].metadata.loopId)
  } else if (activeLoopId()) {
    await loadLoop(activeLoopId()!)
  }
}

async function loadLoop(loopId: string) {
  setActiveLoopId(loopId)
  const data = await getJson<LoopData>(`/api/loops/${encodeURIComponent(loopId)}`)
  setLoopData(data)
}

async function createLoopFromPanel(input: { title: string; objective: string; trigger: LoopTrigger; verifyCommand: string; maxIterations: number; maxTokens: number; manualInterventionAfterFailures?: number; workspaceIsolation: 'none' | 'temp_copy' | 'git_worktree' }) {
  const result = await postJson<{ ok: boolean; error?: string; summary?: LoopSummary }>('/api/loops', {
    ...input,
    goalId: activeGoalId(),
  })
  if (!result.ok || !result.summary) {
    showToast(result.error ?? 'Loop create failed')
    return
  }
  setActiveLoopId(result.summary.metadata.loopId)
  await refreshLoops()
  showToast(`Loop created: ${result.summary.metadata.loopId}`)
}

async function runLoop(loopId: string) {
  await runLoopAction(loopId, 'run')
}

async function resumeLoop(loopId: string) {
  await runLoopAction(loopId, 'resume')
}

async function pauseLoop(loopId: string) {
  await runLoopAction(loopId, 'pause')
}

async function stopLoop(loopId: string) {
  await runLoopAction(loopId, 'stop')
}

async function runLoopAction(loopId: string, action: 'run' | 'resume' | 'pause' | 'stop') {
  if (loopRunning()) return
  setLoopRunning(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; summary?: LoopSummary }>(
      `/api/loops/${encodeURIComponent(loopId)}/${action}`,
      { goalId: activeGoalId() },
    )
    if (!result.ok) {
      showToast(result.error ?? `Loop ${action} failed`)
      return
    }
    await refreshLoops()
    await refreshSystemStatus()
    showToast(`Loop ${action}: ${result.summary?.metadata.status ?? 'ok'}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setLoopRunning(false)
  }
}

async function refreshGateway() {
  setGatewayStatus(await getJson<GatewayStatus>('/api/gateway'))
}

async function startGatewayWorker() {
  if (gatewayWorking()) return
  setGatewayWorking(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; worker?: GatewayStatus['worker'] }>('/api/gateway/start', {})
    if (!result.ok) {
      showToast(result.error ?? 'Gateway worker start failed')
      return
    }
    await refreshGateway()
    showToast(result.worker?.running ? 'Gateway worker started' : 'Gateway worker start requested')
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setGatewayWorking(false)
  }
}

async function recoverGatewayWorker() {
  if (gatewayWorking()) return
  setGatewayWorking(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; recovered?: boolean; message?: string; worker?: GatewayStatus['worker'] }>('/api/gateway/recover', {})
    if (!result.ok) {
      showToast(result.error ?? 'Gateway recovery failed')
      return
    }
    await refreshGateway()
    showToast(result.recovered ? 'Gateway recovery started' : result.message ?? 'Gateway recovery not required')
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setGatewayWorking(false)
  }
}

async function stopGatewayWorker() {
  if (gatewayWorking()) return
  setGatewayWorking(true)
  try {
    const result = await postJson<{ ok: boolean; error?: string; stopped?: boolean; worker?: GatewayStatus['worker'] }>('/api/gateway/stop', {})
    if (!result.ok) {
      showToast(result.error ?? 'Gateway worker stop failed')
      return
    }
    await refreshGateway()
    showToast(result.stopped ? 'Gateway worker stopped' : 'Gateway worker stop requested')
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setGatewayWorking(false)
  }
}

async function refreshAcceptance() {
  setAcceptanceStatus(await getJson<AcceptanceStatus>('/api/acceptance'))
}

async function runAcceptance(mode: 'dry_run' | 'quick') {
  if (acceptanceRunning()) return
  setAcceptanceRunning(true)
  try {
    const result = await postJson<{
      ok: boolean
      error?: string
      mode: 'dry_run' | 'quick'
      runId: string
      acceptance?: AcceptanceStatus
      stderrPreview?: string
    }>('/api/acceptance/run', {
      mode,
      profile: 'required',
      only: mode === 'quick' ? ['typecheck', 'check'] : undefined,
      goalId: activeGoalId(),
    })
    if (result.acceptance) setAcceptanceStatus(result.acceptance)
    else await refreshAcceptance()
    if (!result.ok) {
      showToast(result.error ?? result.stderrPreview ?? `Acceptance ${mode} failed`)
      return
    }
    showToast(`Acceptance ${mode}: ${result.runId}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setAcceptanceRunning(false)
  }
}

async function sendGatewayCommand() {
  const text = gatewayCommand().trim()
  if (!text) return
  const result = await postJson<{ ok: boolean; error?: string; outbox?: GatewayStatus['outbox'] }>('/api/gateway/message', { text })
  if (!result.ok) {
    showToast(result.error ?? 'Gateway command failed')
    return
  }
  await refreshGateway()
  showToast(`Gateway command sent: ${text}`)
}

async function loadThread(threadId: string) {
  const data = await getJson<ThreadData>(`/api/threads/${encodeURIComponent(threadId)}`)
  const loadedEvents = data.events ?? []
  setThreadData(data)
  setEvents(loadedEvents)
  setThreadExport(undefined)
  setSelectedEvent([...loadedEvents].reverse().find(event => isRenderableEvent(event, loadedEvents)))
}

async function createThread() {
  const metadata = await postJson<ThreadMetadata>('/api/threads', { title: 'New Pando session', goalId: activeGoalId() })
  await refreshThreads()
  setActiveThreadId(metadata.threadId)
  showToast('Session created')
}

async function renameActiveThread(title: string) {
  const threadId = activeThreadId()
  if (!threadId) {
    showToast('Create or select a thread first')
    return
  }
  const result = await postJson<{ ok: boolean; error?: string; metadata?: ThreadMetadata }>(
    `/api/threads/${encodeURIComponent(threadId)}/rename`,
    { title },
  )
  if (!result.ok || !result.metadata) {
    showToast(result.error ?? 'Thread rename failed')
    return
  }
  await refreshThreads()
  await loadThread(threadId)
  showToast(`Thread renamed: ${result.metadata.title}`)
}

async function branchActiveThread(title: string) {
  const threadId = activeThreadId()
  if (!threadId) {
    showToast('Create or select a thread first')
    return
  }
  const result = await postJson<{ ok: boolean; error?: string; metadata?: ThreadMetadata }>(
    `/api/threads/${encodeURIComponent(threadId)}/branch`,
    { title },
  )
  if (!result.ok || !result.metadata) {
    showToast(result.error ?? 'Thread branch failed')
    return
  }
  await refreshThreads()
  setActiveThreadId(result.metadata.threadId)
  await loadThread(result.metadata.threadId)
  showToast(`Branch created: ${result.metadata.title}`)
}

async function exportActiveThread(format: 'md' | 'json') {
  const threadId = activeThreadId()
  if (!threadId) {
    showToast('Create or select a thread first')
    return
  }
  const result = await getJson<ThreadExportResponse>(`/api/threads/${encodeURIComponent(threadId)}/export?format=${format}`)
  if (!result.ok) {
    showToast(result.error ?? 'Thread export failed')
    return
  }
  setThreadExport(result)
  showToast(`Thread exported as ${result.format.toUpperCase()}`)
}

async function submitPrompt(explicitPrompt?: string) {
  const text = (explicitPrompt ?? prompt()).trim()
  if (!text || running()) return
  setRunning(true)
  try {
    let threadId = activeThreadId()
    if (!threadId) {
      const metadata = await postJson<ThreadMetadata>('/api/threads', { title: text.slice(0, 80), goalId: activeGoalId() })
      threadId = metadata.threadId
      setActiveThreadId(threadId)
      await refreshThreads()
    }
    setPrompt('')
    const result = await postJson<{ ok: boolean; error?: string; threadId: string }>('/api/chat', { threadId, prompt: text, goalId: activeGoalId() })
    if (!result.ok) showToast(result.error ?? 'Run failed')
    await refreshThreads()
    await refreshGoals()
    await loadThread(threadId)
    await refreshSystemStatus()
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error))
  } finally {
    setRunning(false)
  }
}

async function respondApproval(approvalId: string, decision: string) {
  const result = await postJson<{ ok: boolean; error?: string }>(`/api/approval/${approvalId}`, { decision })
  if (!result.ok) {
    showToast(result.error ?? 'Approval failed')
    return
  }
  setPendingApprovals(current => current.filter(item => item.approvalId !== approvalId))
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  return response.json()
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

function parseEventData<T>(event: Event): T | undefined {
  const data = (event as MessageEvent).data
  if (typeof data !== 'string') return undefined
  try {
    return JSON.parse(data) as T
  } catch {
    return undefined
  }
}

function modelLabel(metadata?: ThreadMetadata): string {
  const model = metadata?.model
  if (!model) return ''
  return model.name ? `${model.provider}/${model.name}` : model.provider
}

function modelLabelFromDoctor(report?: DoctorReport): string {
  if (!report?.model) return 'unknown'
  return report.model.name ? `${report.model.provider}/${report.model.name}` : report.model.provider
}

function defaultApiKeyEnv(providerId: string): string {
  switch (providerId) {
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'deepseek':
      return 'DEEPSEEK_API_KEY'
    case 'minimax-cn':
      return 'MINIMAX_CN_API_KEY'
    case 'custom':
      return 'CUSTOM_LLM_API_KEY'
    default:
      return `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  }
}

function providerRegionLabel(providerId: string): string {
  if (providerId === 'minimax-cn' || providerId === 'deepseek') return 'China-ready'
  if (providerId === 'custom') return 'custom route'
  if (providerId === 'openai') return 'global'
  return providerId ? 'provider-defined' : 'not selected'
}

function authStatusLabel(authType: string, apiKeyEnv: string, provider?: ModelProviderCatalogItem): string {
  if (authType === 'none') return 'no key required'
  if (provider?.error) return 'auth check failed'
  return apiKeyEnv ? `${apiKeyEnv} env` : 'API key env required'
}

function contextWindowLabel(capabilities: Record<string, boolean | number> | undefined): string {
  const windowTokens = capabilities?.contextWindowTokens
  return typeof windowTokens === 'number' ? `${formatNumber(windowTokens)} tokens` : 'unknown window'
}

function capabilityBadges(capabilities: Record<string, boolean | number> | undefined): { label: string; value: string; enabled: boolean }[] {
  return [
    capabilityBadge('Tools', capabilities?.tools),
    capabilityBadge('Vision', capabilities?.vision),
    capabilityBadge('Streaming', capabilities?.streaming),
    capabilityBadge('Reasoning', capabilities?.reasoning),
    {
      label: 'Context',
      value: contextWindowLabel(capabilities),
      enabled: typeof capabilities?.contextWindowTokens === 'number',
    },
  ]
}

function capabilityBadge(label: string, value: unknown): { label: string; value: string; enabled: boolean } {
  return {
    label,
    value: value === true ? 'yes' : 'no',
    enabled: value === true,
  }
}

function capabilityLabel(capabilities: Record<string, boolean | number> | undefined): string {
  if (!capabilities) return 'capabilities unknown'
  const enabled = Object.entries(capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
  const windowTokens = capabilities.contextWindowTokens
  return `${enabled.join('+') || 'text'}${typeof windowTokens === 'number' ? ` / ${formatNumber(windowTokens)} ctx` : ''}`
}

function permissionLabel(metadata?: ThreadMetadata): string {
  const permissions = metadata?.permissions
  if (!permissions) return 'default'
  return `${permissions.sandboxMode}/${permissions.approvalPolicy}`
}

function contextLabel(event?: AgentEvent): string {
  if (!event) return 'idle'
  const retained = event.retainedMessageCount ?? 0
  const source = event.sourceMessageCount ?? 0
  const dropped = event.droppedMessageCount ?? 0
  const tokens = event.tokenBudget?.estimatedTokensLeft
  const tokenText = tokens === undefined ? undefined : `${formatNumber(tokens)} left`
  if (source === 0) return tokenText ?? 'empty'
  const liveText = dropped > 0 ? `${retained}/${source} live` : `${retained} live`
  return tokenText ? `${liveText}, ${tokenText}` : liveText
}

function compactLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return 'none'
  const record = value as { windowId?: number; compactionWindowId?: number }
  const windowId = record.windowId ?? record.compactionWindowId
  return windowId === undefined ? 'active' : `window ${windowId}`
}

function guiLabel(report?: GuiReport): string {
  if (!report) return 'check'
  if (!report.ok) return 'missing'
  const methods = [
    report.methods.uia ? 'uia' : undefined,
    report.methods.visual ? 'visual' : undefined,
    report.methods.screenshot ? 'shot' : undefined,
  ].filter(Boolean)
  return methods.join('+') || 'ok'
}

function gatewayChannelDetail(channel: GatewayChannelView): string {
  const parts = [
    channel.outboundStatus ? `outbound: ${channel.outboundStatus}` : undefined,
    channel.inboundStatus ? `inbound: ${channel.inboundStatus}` : undefined,
  ].filter(Boolean)
  return parts.join(' / ') || 'single path'
}

function gatewayChannelReady(channel: GatewayChannelView): boolean {
  if (channel.status === 'connected' || channel.status === 'configured') return true
  return channel.outboundStatus === 'configured' || channel.inboundStatus === 'configured'
}

function gatewayToneFor(status: string, pendingApprovals: number, staleRuns: number, toolFailures: number): 'ok' | 'warn' | 'danger' {
  if (status === 'failed' || status === 'stale') return 'danger'
  if (pendingApprovals || staleRuns || toolFailures || status === 'not_started' || status === 'stopped') return 'warn'
  return 'ok'
}

function acceptanceLabel(status?: AcceptanceStatus): string {
  const latest = status?.latest
  if (!status || status.status === 'missing' || !latest) return 'missing'
  if (latest.status === 'passed') return `${latest.passedStepCount}/${latest.selectedStepCount} passed`
  if (latest.status === 'dry_run') return 'dry run'
  return `${latest.failedStepCount} failed`
}

function goalLabel(goal?: GoalSummary | GoalData): string {
  if (!goal) return 'none'
  return `${goal.metadata.status} ${goal.metadata.progressPercent}%`
}

function goalTone(goal?: GoalSummary | GoalData): 'ok' | 'warn' | undefined {
  if (!goal) return 'warn'
  if (goal.metadata.status === 'completed') return 'ok'
  if (goal.metadata.status === 'blocked' || goal.metadata.status === 'usage_limited' || goal.metadata.status === 'budget_limited') return 'warn'
  return undefined
}

function usageLabel(event?: AgentEvent): string {
  const usage = event?.usage
  if (!usage) return 'none'
  if (typeof usage.total_tokens === 'number') return `${formatNumber(usage.total_tokens)} tok`
  if (typeof usage.total_characters === 'number') return `${formatNumber(usage.total_characters)} chars`
  return 'recorded'
}

function statusText(event: AgentEvent): string {
  if (event.type === 'model_retry_scheduled') return String(event.category ?? 'retry')
  if (typeof event.approved === 'boolean') return event.approved ? 'approved' : 'denied'
  if (typeof event.ok === 'boolean') return event.ok ? 'ok' : failureCode(event) ?? 'failed'
  return event.risk ? String(event.risk) : 'info'
}

function toolEventPreview(event: AgentEvent): string {
  const failure = failureLabel(event)
  if (event.type === 'model_retry_scheduled') {
    return `attempt ${String(event.nextAttempt ?? '?')} after ${String(event.delayMs ?? 0)}ms: ${String(event.message ?? '')}`
  }
  const preview = event.contentPreview ?? event.message ?? event.reason ?? 'No preview'
  return failure ? `${failure}: ${preview}` : preview
}

function failureLabel(event: AgentEvent): string | undefined {
  const code = failureCode(event)
  const category = failureCategory(event)
  if (code && category) return `${code} / ${category}`
  return code ?? category
}

function failureCode(event: AgentEvent): string | undefined {
  return metadataString(event, 'code')
}

function failureCategory(event: AgentEvent): string | undefined {
  return metadataString(event, 'category')
}

function metadataString(event: AgentEvent, key: string): string | undefined {
  const value = event.metadata?.[key]
  return typeof value === 'string' && value ? value : undefined
}

function isRenderableEvent(event: AgentEvent, allEvents: AgentEvent[] = []): boolean {
  if (
    event.type === 'agent_message_delta' ||
    event.type === 'model_request_started' ||
    event.type === 'model_response_completed' ||
    event.type === 'tool_result' ||
    event.type === 'preflight_started' ||
    event.type === 'preflight_completed' ||
    event.type === 'mcp_server_started' ||
    event.type === 'mcp_server_connected'
  ) {
    return false
  }
  if (event.type === 'turn_completed') {
    return !allEvents.some(item => item.turnId === event.turnId && item.type === 'agent_message_completed')
  }
  return true
}

function contextSummary(event: AgentEvent): string {
  const retained = event.retainedMessageCount ?? 0
  const source = event.sourceMessageCount ?? 0
  const dropped = event.droppedMessageCount ?? 0
  const compacted = event.compactedMessageCount ?? 0
  const tokenText = event.tokenBudget?.estimatedTokensLeft === undefined
    ? undefined
    : `${formatNumber(event.tokenBudget.estimatedTokensLeft)} tokens left`
  if (source === 0) return tokenText ? `No prior messages. ${tokenText}.` : 'No prior messages.'
  const parts = [`${retained} of ${source} message(s) live`]
  if (dropped > 0) parts.push(`${dropped} dropped`)
  if (compacted > 0 || event.compactionSummaryIncluded) parts.push(`${compacted} compacted`)
  if (tokenText) parts.push(tokenText)
  return `${parts.join(', ')}.`
}

function formatInlineJson(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value)
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(value: number): string {
  if (!value) return '0ms'
  if (value < 1000) return `${value}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function timeAgo(value: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

function showToast(message: string) {
  setToast(message)
  setTimeout(() => setToast(undefined), 2800)
}

let lastAutoScroll = { top: 0, time: 0 }

function markAutoScroll(element: HTMLElement) {
  lastAutoScroll = {
    top: Math.max(0, element.scrollHeight - element.clientHeight),
    time: Date.now(),
  }
}

function isRecentAutoScroll(element: HTMLElement): boolean {
  return Date.now() - lastAutoScroll.time < 1000 && Math.abs(element.scrollTop - lastAutoScroll.top) < 3
}

function iconPath(name: string): string {
  switch (name) {
    case 'plus':
      return 'M12 5v14M5 12h14'
    case 'search':
      return 'M10.8 18a7.2 7.2 0 1 1 5.1-2.1L21 21'
    case 'files':
      return 'M7 3h7l3 3v13H7zM4 7h2v14h11'
    case 'folder':
      return 'M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
    case 'file':
      return 'M6 3h8l4 4v14H6zM14 3v5h5'
    case 'settings':
      return 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7m0-5v3m0 11v3m7.4-13-2.6 1.5M7.2 15 4.6 16.5m14.8 0-2.6-1.5M7.2 9 4.6 7.5'
    case 'help':
      return 'M9.5 9a2.7 2.7 0 1 1 4.6 1.9c-.9.8-2.1 1.4-2.1 3.1M12 18h.01M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20'
    case 'back':
      return 'M15 18l-6-6 6-6'
    case 'forward':
      return 'M9 18l6-6-6-6'
    case 'layout':
      return 'M4 5h16v14H4zM14 5v14'
    case 'close':
      return 'M6 6l12 12M18 6 6 18'
    case 'edit':
      return 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17zM13.5 8.5l3 3'
    case 'panelLeft':
      return 'M4 5h16v14H4zM10 5v14M7 9l-2 3 2 3'
    case 'panelRight':
      return 'M4 5h16v14H4zM10 5v14M7 9l-2 3 2 3'
    case 'refresh':
      return 'M20 12a8 8 0 0 1-13.7 5.7L4 15m0 0v5h5M4 12A8 8 0 0 1 17.7 6.3L20 9m0 0V4h-5'
    case 'check':
      return 'm5 12 4 4L19 6'
    case 'terminal':
      return 'm5 7 5 5-5 5M12 19h7'
    case 'paperclip':
      return 'm21 12-8.5 8.5a5 5 0 0 1-7.1-7.1L14 4.8a3.2 3.2 0 0 1 4.5 4.5l-8.7 8.7a1.4 1.4 0 0 1-2-2L16 7.8'
    case 'image':
      return 'M4 5h16v14H4zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4m12 5-4.5-4.5L6 19'
    case 'slash':
      return 'M15 4 9 20'
    case 'model':
      return 'M12 3 4 7v10l8 4 8-4V7zm0 0v18M4 7l8 4 8-4'
    case 'play':
      return 'M8 5v14l11-7z'
    case 'stop':
      return 'M8 8h8v8H8z'
    case 'arrowUp':
      return 'M12 19V5m0 0-6 6m6-6 6 6'
    case 'loader':
      return 'M12 3a9 9 0 0 1 9 9'
    case 'user':
      return 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10'
    case 'spark':
      return 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z'
    case 'wrench':
      return 'M14.7 6.3a4 4 0 0 0 5 5L11 20l-5-5 8.7-8.7z'
    case 'shield':
      return 'M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6z'
    case 'layers':
      return 'm12 3 9 5-9 5-9-5zm-7 9 7 4 7-4M5 16l7 4 7-4'
    case 'warning':
      return 'M12 4 2 21h20zM12 10v5m0 3h.01'
    case 'dot':
    default:
      return 'M12 12h.01'
  }
}

render(() => <App />, document.getElementById('root')!)
