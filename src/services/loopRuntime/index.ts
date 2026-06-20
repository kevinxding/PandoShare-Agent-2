import { spawn } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { QueryEngine, type QueryEngineOptions } from '../../QueryEngine.js'
import type { ToolApprovalHandler } from '../../Tool.js'
import { createDefaultToolRegistry, type ToolRegistry } from '../../tools.js'
import type { ProjectConfig } from '../config/index.js'
import { eventBase, previewText, type AgentEventHandler } from '../events/index.js'
import { generateText } from '../llm/client.js'
import { resolveDefaultModel } from '../config/index.js'
import type { GenerateOptions } from '../llm/types.js'
import { LocalGoalStore } from '../goalStore/index.js'

export type LoopTrigger = 'manual' | 'schedule' | 'heartbeat'

export type LoopStatus = 'created' | 'running' | 'paused' | 'completed' | 'failed' | 'blocked' | 'stopped'

export type LoopWorkspaceIsolation = 'none' | 'git_worktree' | 'temp_copy'

export type LoopVerification =
  | {
      type: 'command'
      command: string
      cwd?: string
      timeoutMs?: number
      successExitCodes?: readonly number[]
    }
  | {
      type: 'file'
      path: string
      exists?: boolean
      contains?: string
      notContains?: string
    }
  | {
      type: 'model'
      prompt?: string
      passText?: string
    }
  | {
      type: 'custom'
      name: string
      command?: string
      timeoutMs?: number
    }

export type LoopFailurePolicy = {
  maxIterations?: number
  maxRuntimeMs?: number
  maxConsecutiveFailures?: number
  maxTokens?: number
  manualIntervention?: {
    afterConsecutiveFailures?: number
    afterIterations?: number
    failureTextPatterns?: readonly string[]
  }
}

export type LoopSpec = {
  loopId?: string
  goalId?: string
  title?: string
  objective: string
  trigger?: LoopTrigger
  cwd?: string
  workspaceIsolation?: LoopWorkspaceIsolation
  allowedTools?: readonly string[]
  requiredSkills?: readonly string[]
  successCriteria?: string
  verification?: readonly LoopVerification[]
  failurePolicy?: LoopFailurePolicy
  maxIterations?: number
  maxRuntimeMs?: number
  delivery?: {
    channel?: string
    notifyOn?: readonly ('completed' | 'failed' | 'blocked' | 'paused')[]
  }
}

export type LoopMetadata = {
  loopId: string
  title: string
  objective: string
  trigger: LoopTrigger
  cwd: string
  status: LoopStatus
  createdAtMs: number
  updatedAtMs: number
  sessionId: string
  threadId?: string
  goalId?: string
  currentRunId?: string
  currentWorkspaceCwd?: string
  workspaceIsolation: LoopWorkspaceIsolation
  spec: LoopSpec
}

export type LoopRunRecord = {
  runId: string
  loopId: string
  sessionId: string
  startedAtMs: number
  completedAtMs?: number
  status: LoopStatus
  iterationCount: number
  finalMessage?: string
  threadId?: string
  goalId?: string
  workspaceCwd?: string
  workspaceIsolation?: LoopWorkspaceIsolation
  usedTokens?: number
}

export type LoopVerificationResult = {
  type: LoopVerification['type']
  ok: boolean
  message: string
  exitCode?: number
  stdoutPreview?: string
  stderrPreview?: string
}

export type LoopIterationRecord = {
  iterationId: string
  loopId: string
  runId: string
  index: number
  startedAtMs: number
  completedAtMs: number
  status: 'completed' | 'failed'
  promptPreview: string
  finalTextPreview: string
  verification: readonly LoopVerificationResult[]
  threadId?: string
  workspaceCwd?: string
  usageTokens?: number
}

export type LoopEvent = {
  eventId: string
  loopId: string
  runId?: string
  iterationId?: string
  type: string
  createdAtMs: number
  message?: string
  status?: LoopStatus
  data?: unknown
}

export type LoopSummary = {
  metadata: LoopMetadata
  runCount: number
  iterationCount: number
  eventCount: number
  lastRun?: LoopRunRecord
  lastIteration?: LoopIterationRecord
}

export type LoopExportFormat = 'json' | 'md'

export type LoopExportData = {
  metadata: LoopMetadata
  state: string
  runs: LoopRunRecord[]
  iterations: LoopIterationRecord[]
  events: LoopEvent[]
}

export type LoopRuntimeRunOptions = {
  sessionId: string
  config?: ProjectConfig
  registry?: ToolRegistry
  fetch?: GenerateOptions['fetch']
  maxToolRounds?: number
  requestToolApproval?: ToolApprovalHandler
  onEvent?: AgentEventHandler
  metadata?: Record<string, unknown>
  resume?: boolean
  goalId?: string
}

export type LoopRunOutput = {
  metadata: LoopMetadata
  run: LoopRunRecord
  iterations: LoopIterationRecord[]
}

type LoopWorkspace = {
  cwd: string
  isolation: LoopWorkspaceIsolation
  cleanup?: () => Promise<void>
}

const LOOPS_DIR = '.pandoshare/loops'
const METADATA_FILE = 'metadata.json'
const STATE_FILE = 'state.md'
const RUNS_FILE = 'runs.jsonl'
const ITERATIONS_FILE = 'iterations.jsonl'
const EVENTS_FILE = 'events.jsonl'

export class LocalLoopStore {
  readonly root: string

  constructor(readonly workspaceRoot: string) {
    this.root = resolve(workspaceRoot, LOOPS_DIR)
  }

  async createLoop(spec: LoopSpec, input: { sessionId: string; cwd?: string } = { sessionId: 'loop-create' }): Promise<LoopMetadata> {
    const now = Date.now()
    const objective = spec.objective?.trim()
    if (!objective) throw new Error('Loop objective must not be empty')
    const loopId = spec.loopId ?? generateLoopId(now)
    const cwd = resolve(input.cwd ?? spec.cwd ?? this.workspaceRoot)
    const metadata: LoopMetadata = {
      loopId: sanitizeLoopId(loopId),
      title: spec.title?.trim() || defaultLoopTitle(loopId, objective),
      objective,
      trigger: spec.trigger ?? 'manual',
      cwd,
      status: 'created',
      createdAtMs: now,
      updatedAtMs: now,
      sessionId: input.sessionId,
      goalId: spec.goalId,
      workspaceIsolation: spec.workspaceIsolation ?? 'none',
      spec: {
        ...spec,
        loopId,
        goalId: spec.goalId,
        objective,
        cwd,
        trigger: spec.trigger ?? 'manual',
        workspaceIsolation: spec.workspaceIsolation ?? 'none',
      },
    }
    await mkdir(this.loopPath(metadata.loopId), { recursive: true })
    await this.writeMetadata(metadata)
    await ensureLoopFiles(this.loopPath(metadata.loopId))
    await this.writeState(metadata, 'Loop created.')
    await this.appendEvent(metadata.loopId, {
      type: 'loop_created',
      message: 'Loop created.',
      status: metadata.status,
    })
    return metadata
  }

  async listLoops(): Promise<LoopMetadata[]> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root)
    const loops: LoopMetadata[] = []
    for (const entry of entries) {
      const path = this.loopPath(entry)
      if (!(await isDirectory(path))) continue
      try {
        loops.push(await this.readMetadata(entry))
      } catch {
        // Ignore malformed loops so one bad folder does not hide the rest.
      }
    }
    return loops.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }

  async listSummaries(input: { limit?: number } = {}): Promise<LoopSummary[]> {
    const metadata = await this.listLoops()
    const summaries: LoopSummary[] = []
    for (const item of metadata) {
      summaries.push(await this.readSummary(item.loopId))
      if (input.limit !== undefined && summaries.length >= input.limit) break
    }
    return summaries
  }

  async readSummary(loopId: string): Promise<LoopSummary> {
    const metadata = await this.readMetadata(loopId)
    const runs = await this.readRuns(loopId)
    const iterations = await this.readIterations(loopId)
    const events = await this.readEvents(loopId)
    return {
      metadata,
      runCount: runs.length,
      iterationCount: iterations.length,
      eventCount: events.length,
      lastRun: runs[runs.length - 1],
      lastIteration: iterations[iterations.length - 1],
    }
  }

  async readExport(loopId: string): Promise<LoopExportData> {
    return {
      metadata: await this.readMetadata(loopId),
      state: await this.readState(loopId),
      runs: await this.readRuns(loopId),
      iterations: await this.readIterations(loopId),
      events: await this.readEvents(loopId),
    }
  }

  async exportLoop(loopId: string, format: LoopExportFormat = 'md'): Promise<string> {
    const data = await this.readExport(loopId)
    return format === 'json' ? `${JSON.stringify(data, null, 2)}\n` : formatLoopMarkdown(data)
  }

  async readMetadata(loopId: string): Promise<LoopMetadata> {
    return JSON.parse(await readFile(this.filePath(loopId, METADATA_FILE), 'utf8')) as LoopMetadata
  }

  async writeMetadata(metadata: LoopMetadata): Promise<void> {
    await mkdir(this.loopPath(metadata.loopId), { recursive: true })
    await writeJsonFile(this.filePath(metadata.loopId, METADATA_FILE), metadata)
  }

  async updateMetadata(loopId: string, patch: Partial<LoopMetadata>): Promise<LoopMetadata> {
    const current = await this.readMetadata(loopId)
    const next = {
      ...current,
      ...patch,
      updatedAtMs: Date.now(),
    }
    await this.writeMetadata(next)
    return next
  }

  async updateStatus(loopId: string, status: LoopStatus, message?: string): Promise<LoopMetadata> {
    const metadata = await this.updateMetadata(loopId, { status })
    await this.writeState(metadata, message ?? `Loop status changed to ${status}.`)
    await this.appendEvent(loopId, {
      type: 'loop_status_changed',
      status,
      message: message ?? `Loop status changed to ${status}.`,
    })
    return metadata
  }

  async appendRun(loopId: string, run: LoopRunRecord): Promise<void> {
    await appendJsonLine(this.filePath(loopId, RUNS_FILE), run)
    await this.touch(loopId)
  }

  async completeRun(loopId: string, runId: string, patch: Partial<LoopRunRecord>): Promise<LoopRunRecord> {
    const runs = await this.readRuns(loopId)
    const index = runs.findIndex(run => run.runId === runId)
    if (index === -1) throw new Error(`Missing loop run: ${runId}`)
    const next = {
      ...runs[index],
      ...patch,
    }
    runs[index] = next
    await writeJsonLines(this.filePath(loopId, RUNS_FILE), runs)
    await this.touch(loopId)
    return next
  }

  async readRuns(loopId: string): Promise<LoopRunRecord[]> {
    return readJsonLines<LoopRunRecord>(this.filePath(loopId, RUNS_FILE))
  }

  async appendIteration(loopId: string, iteration: LoopIterationRecord): Promise<void> {
    await appendJsonLine(this.filePath(loopId, ITERATIONS_FILE), iteration)
    await this.touch(loopId)
  }

  async readIterations(loopId: string): Promise<LoopIterationRecord[]> {
    return readJsonLines<LoopIterationRecord>(this.filePath(loopId, ITERATIONS_FILE))
  }

  async appendEvent(loopId: string, input: Omit<LoopEvent, 'eventId' | 'loopId' | 'createdAtMs'>): Promise<void> {
    const event: LoopEvent = {
      eventId: `loop_event_${Date.now()}_${shortId()}`,
      loopId,
      createdAtMs: Date.now(),
      ...input,
    }
    await appendJsonLine(this.filePath(loopId, EVENTS_FILE), event)
    await this.touch(loopId)
  }

  async readEvents(loopId: string): Promise<LoopEvent[]> {
    return readJsonLines<LoopEvent>(this.filePath(loopId, EVENTS_FILE))
  }

  async writeState(metadata: LoopMetadata, message: string): Promise<void> {
    const lines = [
      `# ${metadata.title}`,
      '',
      `- loopId: ${metadata.loopId}`,
      `- status: ${metadata.status}`,
      `- trigger: ${metadata.trigger}`,
      `- cwd: ${metadata.cwd}`,
      `- threadId: ${metadata.threadId ?? 'none'}`,
      `- updatedAt: ${formatTime(metadata.updatedAtMs)}`,
      '',
      '## Objective',
      '',
      metadata.objective,
      '',
      '## Success Criteria',
      '',
      metadata.spec.successCriteria ?? '(not specified)',
      '',
      '## Last Update',
      '',
      message,
      '',
    ]
    await writeFile(this.filePath(metadata.loopId, STATE_FILE), `${lines.join('\n')}\n`, 'utf8')
  }

  async readState(loopId: string): Promise<string> {
    return readFile(this.filePath(loopId, STATE_FILE), 'utf8')
  }

  loopPath(loopId: string): string {
    return join(this.root, sanitizeLoopId(loopId))
  }

  loopRunWorkspacePath(loopId: string, runId: string): string {
    return join(this.loopPath(loopId), 'workspaces', sanitizeLoopId(runId))
  }

  filePath(loopId: string, filename: string): string {
    return join(this.loopPath(loopId), filename)
  }

  private async touch(loopId: string): Promise<void> {
    const metadata = await this.readMetadata(loopId)
    await this.writeMetadata({
      ...metadata,
      updatedAtMs: Date.now(),
    })
  }
}

export class LoopRuntime {
  constructor(readonly store: LocalLoopStore) {}

  async runLoop(loopId: string, options: LoopRuntimeRunOptions): Promise<LoopRunOutput> {
    let metadata = await this.store.readMetadata(loopId)
    if (metadata.status === 'running') throw new Error(`Loop is already running: ${loopId}`)
    if (metadata.status === 'stopped' && !options.resume) throw new Error(`Loop is stopped: ${loopId}`)
    if (metadata.status === 'paused' && !options.resume) throw new Error(`Loop is paused: ${loopId}`)

    const runId = `loop_run_${Date.now()}_${shortId()}`
    const startedAtMs = Date.now()
    const goalId = options.goalId ?? metadata.goalId ?? metadata.spec.goalId
    const goalStore = goalId ? new LocalGoalStore(this.store.workspaceRoot) : undefined
    if (goalId && goalStore) await goalStore.readSummary(goalId)
    const workspace = await prepareLoopWorkspace(this.store, metadata, runId)
    const run: LoopRunRecord = {
      runId,
      loopId: metadata.loopId,
      sessionId: options.sessionId,
      startedAtMs,
      status: 'running',
      iterationCount: 0,
      threadId: metadata.threadId,
      goalId,
      workspaceCwd: workspace.cwd,
      workspaceIsolation: workspace.isolation,
    }
    await this.store.appendRun(loopId, run)
    if (goalId && goalStore) {
      await goalStore.appendRun(goalId, {
        runId,
        kind: 'loop',
        status: 'started',
        startedAtMs,
        loopId: metadata.loopId,
        summary: 'Loop run started.',
      })
      await goalStore.appendProgress(goalId, `Loop ${metadata.loopId} started.`)
    }
    metadata = await this.store.updateMetadata(loopId, {
      status: 'running',
      sessionId: options.sessionId,
      goalId,
      currentRunId: runId,
      currentWorkspaceCwd: workspace.cwd,
    })
    await this.store.writeState(metadata, 'Loop run started.')
    await this.store.appendEvent(loopId, {
      type: 'loop_run_started',
      runId,
      status: 'running',
      message: 'Loop run started.',
      data: {
        workspaceCwd: workspace.cwd,
        workspaceIsolation: workspace.isolation,
      },
    })

    const iterations: LoopIterationRecord[] = []
    const maxIterations = loopMaxIterations(metadata.spec)
    const maxRuntimeMs = loopMaxRuntimeMs(metadata.spec)
    const maxConsecutiveFailures = loopMaxConsecutiveFailures(metadata.spec)
    const maxTokens = loopMaxTokens(metadata.spec)
    let consecutiveFailures = 0
    let usedTokens = 0
    let feedback = ''
    let finalStatus: LoopStatus = 'failed'
    let finalMessage = 'Loop failed before completing.'

    try {
      for (let index = 1; index <= maxIterations; index += 1) {
        if (maxRuntimeMs !== undefined && Date.now() - startedAtMs > maxRuntimeMs) {
          finalStatus = 'blocked'
          finalMessage = `Loop exceeded maxRuntimeMs=${maxRuntimeMs}.`
          break
        }

        metadata = await this.store.readMetadata(loopId)
        if (metadata.status === 'paused' || metadata.status === 'stopped') {
          finalStatus = metadata.status
          finalMessage = `Loop ${metadata.status}.`
          break
        }

        const runtimeMetadata: LoopMetadata = {
          ...metadata,
          cwd: workspace.cwd,
        }
        const iteration = await this.runIteration(runtimeMetadata, runId, index, feedback, options)
        usedTokens += iteration.usageTokens ?? 0
        iterations.push(iteration)
        await this.store.appendIteration(loopId, iteration)
        await this.store.appendEvent(loopId, {
          type: 'loop_iteration_completed',
          runId,
          iterationId: iteration.iterationId,
          status: iteration.status === 'completed' ? 'running' : 'failed',
          message: iteration.status === 'completed' ? 'Loop iteration verifier passed.' : 'Loop iteration verifier failed.',
          data: iteration.verification,
        })

        metadata = await this.store.updateMetadata(loopId, {
          threadId: iteration.threadId ?? metadata.threadId,
        })

        if (maxTokens !== undefined && usedTokens >= maxTokens) {
          finalStatus = 'blocked'
          finalMessage = `Loop reached maxTokens=${maxTokens} after using approximately ${usedTokens} token(s).`
          await this.store.appendEvent(loopId, {
            type: 'loop_failure_policy_triggered',
            runId,
            iterationId: iteration.iterationId,
            status: finalStatus,
            message: finalMessage,
            data: {
              policy: 'maxTokens',
              maxTokens,
              usedTokens,
            },
          })
          await this.store.writeState(metadata, finalMessage)
          break
        }

        if (iteration.status === 'completed') {
          consecutiveFailures = 0
          finalStatus = 'completed'
          finalMessage = 'Loop completed successfully.'
          break
        }

        consecutiveFailures += 1
        feedback = buildVerificationFeedback(iteration.verification)
        const manualIntervention = loopManualIntervention(metadata.spec, {
          iterationIndex: index,
          consecutiveFailures,
          feedback,
          finalText: iteration.finalTextPreview,
        })
        if (manualIntervention) {
          finalStatus = 'blocked'
          finalMessage = `Loop requires manual intervention: ${manualIntervention.message}`
          await this.store.appendEvent(loopId, {
            type: 'loop_manual_intervention_required',
            runId,
            iterationId: iteration.iterationId,
            status: finalStatus,
            message: finalMessage,
            data: {
              reason: manualIntervention.reason,
              policy: manualIntervention.policy,
              consecutiveFailures,
              iterationIndex: index,
              usedTokens,
            },
          })
        } else if (consecutiveFailures >= maxConsecutiveFailures) {
          finalStatus = 'blocked'
          finalMessage = `Loop reached maxConsecutiveFailures=${maxConsecutiveFailures} without passing verification.`
          await this.store.appendEvent(loopId, {
            type: 'loop_failure_policy_triggered',
            runId,
            iterationId: iteration.iterationId,
            status: finalStatus,
            message: finalMessage,
            data: {
              policy: 'maxConsecutiveFailures',
              maxConsecutiveFailures,
              consecutiveFailures,
              usedTokens,
            },
          })
        } else {
          finalStatus = index >= maxIterations ? 'blocked' : 'running'
          finalMessage = index >= maxIterations
          ? `Loop reached maxIterations=${maxIterations} without passing verification.`
          : 'Loop verification failed; continuing with feedback.'
        }
        await this.store.writeState(metadata, finalMessage)
        if (finalStatus === 'blocked') break
      }
    } catch (error) {
      finalStatus = 'failed'
      finalMessage = `Loop run failed: ${errorMessage(error)}`
      await this.store.appendEvent(loopId, {
        type: 'loop_run_failed',
        runId,
        status: 'failed',
        message: finalMessage,
      })
    }

    metadata = await this.store.updateMetadata(loopId, {
      status: finalStatus,
      currentRunId: undefined,
      currentWorkspaceCwd: undefined,
    })
    await this.store.writeState(metadata, finalMessage)
    const completedRun = await this.store.completeRun(loopId, runId, {
      completedAtMs: Date.now(),
      status: finalStatus,
      iterationCount: iterations.length,
      finalMessage,
      threadId: metadata.threadId,
      goalId,
      workspaceCwd: workspace.cwd,
      workspaceIsolation: workspace.isolation,
      usedTokens,
    })
    if (goalId && goalStore) {
      await goalStore.appendRun(goalId, {
        runId,
        kind: 'loop',
        status: finalStatus === 'completed' ? 'completed' : 'failed',
        startedAtMs,
        completedAtMs: Date.now(),
        loopId: metadata.loopId,
        threadId: metadata.threadId,
        summary: finalMessage,
      })
      await goalStore.appendProgress(goalId, `Loop ${metadata.loopId} finished with status ${finalStatus}: ${finalMessage}`)
      if (finalStatus === 'completed') {
        await goalStore.appendEvidence(goalId, {
          type: 'loop',
          strength: 'direct',
          summary: `Loop ${metadata.loopId} completed: ${finalMessage}`,
          loopId: metadata.loopId,
          threadId: metadata.threadId,
        })
      }
      await goalStore.appendCheckpoint(goalId, `Loop ${metadata.loopId} ${finalStatus}: ${finalMessage}`)
    }
    await this.store.appendEvent(loopId, {
      type: 'loop_run_completed',
      runId,
      status: finalStatus,
      message: finalMessage,
      data: {
        iterationCount: iterations.length,
        usedTokens,
      },
    })

    await workspace.cleanup?.()

    return {
      metadata,
      run: completedRun,
      iterations,
    }
  }

  private async runIteration(
    metadata: LoopMetadata,
    runId: string,
    index: number,
    feedback: string,
    options: LoopRuntimeRunOptions,
  ): Promise<LoopIterationRecord> {
    const iterationId = `loop_iter_${Date.now()}_${shortId()}`
    const startedAtMs = Date.now()
    const prompt = buildIterationPrompt(metadata, index, feedback)
    await this.store.appendEvent(metadata.loopId, {
      type: 'loop_iteration_started',
      runId,
      iterationId,
      status: 'running',
      message: `Loop iteration ${index} started.`,
    })
    await options.onEvent?.({
      ...eventBase({ sessionId: options.sessionId }, 'turn_started'),
      type: 'turn_started',
      promptPreview: `loop ${metadata.loopId} iteration ${index}: ${previewText(metadata.objective, 200)}`,
    })

    const engine = new QueryEngine({
      cwd: metadata.cwd,
      sessionId: options.sessionId,
      config: options.config,
      registry: options.registry ?? createDefaultToolRegistry(),
      threadId: metadata.threadId,
      title: metadata.title,
      fetch: options.fetch,
      maxToolRounds: options.maxToolRounds,
      requestToolApproval: options.requestToolApproval,
      onEvent: options.onEvent,
      metadata: options.metadata,
    } satisfies QueryEngineOptions)
    const output = await engine.run(prompt)
    const threadId = engine.threadId()
    const verification = await verifyLoop(metadata, output.finalText, options)
    const ok = verification.every(result => result.ok)
    const usageTokens = extractUsageTokens(output.agent?.usage) ?? estimateTextTokens(output.finalText)
    return {
      iterationId,
      loopId: metadata.loopId,
      runId,
      index,
      startedAtMs,
      completedAtMs: Date.now(),
      status: ok ? 'completed' : 'failed',
      promptPreview: previewText(prompt, 1000),
      finalTextPreview: previewText(output.finalText, 1000),
      verification,
      threadId,
      workspaceCwd: metadata.cwd,
      usageTokens,
    }
  }
}

async function prepareLoopWorkspace(store: LocalLoopStore, metadata: LoopMetadata, runId: string): Promise<LoopWorkspace> {
  switch (metadata.workspaceIsolation) {
    case 'none':
      return {
        cwd: metadata.cwd,
        isolation: 'none',
      }
    case 'temp_copy':
      return prepareTempCopyWorkspace(store, metadata, runId)
    case 'git_worktree':
      return prepareGitWorktreeWorkspace(store, metadata, runId)
  }
}

async function prepareTempCopyWorkspace(store: LocalLoopStore, metadata: LoopMetadata, runId: string): Promise<LoopWorkspace> {
  const target = store.loopRunWorkspacePath(metadata.loopId, runId)
  await mkdir(target, { recursive: true })
  await copyWorkspace(metadata.cwd, target)
  await store.appendEvent(metadata.loopId, {
    type: 'loop_workspace_prepared',
    runId,
    status: 'running',
    message: 'Loop temp copy workspace prepared.',
    data: {
      workspaceIsolation: 'temp_copy',
      sourceCwd: metadata.cwd,
      workspaceCwd: target,
    },
  })
  return {
    cwd: target,
    isolation: 'temp_copy',
  }
}

async function prepareGitWorktreeWorkspace(store: LocalLoopStore, metadata: LoopMetadata, runId: string): Promise<LoopWorkspace> {
  const target = store.loopRunWorkspacePath(metadata.loopId, runId)
  const branch = `pando-loop-${metadata.loopId}-${runId}`.slice(0, 120)
  const inside = await runShellCommand('git rev-parse --is-inside-work-tree', metadata.cwd, 10_000)
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error(`Loop workspaceIsolation=git_worktree requires a git work tree: ${metadata.cwd}`)
  }
  await mkdir(resolve(target, '..'), { recursive: true })
  const add = await runShellCommand(`git worktree add -b ${quoteShellArg(branch)} ${quoteShellArg(target)} HEAD`, metadata.cwd, 60_000)
  if (add.exitCode !== 0) {
    throw new Error(`Failed to create loop git worktree: ${previewText(add.stderr || add.stdout, 1000)}`)
  }
  await store.appendEvent(metadata.loopId, {
    type: 'loop_workspace_prepared',
    runId,
    status: 'running',
    message: 'Loop git worktree prepared.',
    data: {
      workspaceIsolation: 'git_worktree',
      sourceCwd: metadata.cwd,
      workspaceCwd: target,
      branch,
    },
  })
  return {
    cwd: target,
    isolation: 'git_worktree',
  }
}

async function verifyLoop(
  metadata: LoopMetadata,
  finalText: string,
  options: LoopRuntimeRunOptions,
): Promise<LoopVerificationResult[]> {
  const verifiers = metadata.spec.verification?.length
    ? metadata.spec.verification
    : [{ type: 'model', passText: 'PASS' } satisfies LoopVerification]
  const results: LoopVerificationResult[] = []
  for (const verifier of verifiers) {
    switch (verifier.type) {
      case 'command':
        results.push(await runCommandVerifier(metadata.cwd, verifier))
        break
      case 'file':
        results.push(await runFileVerifier(metadata.cwd, verifier))
        break
      case 'model':
        results.push(await runModelVerifier(metadata, finalText, verifier, options))
        break
      case 'custom':
        results.push(await runCustomVerifier(metadata.cwd, verifier))
        break
    }
  }
  return results
}

async function runCommandVerifier(workspaceRoot: string, verifier: Extract<LoopVerification, { type: 'command' }>): Promise<LoopVerificationResult> {
  const cwd = verifier.cwd ? resolveInside(workspaceRoot, verifier.cwd) : workspaceRoot
  const result = await runShellCommand(verifier.command, cwd, verifier.timeoutMs ?? 30_000)
  const allowed = new Set(verifier.successExitCodes ?? [0])
  const ok = allowed.has(result.exitCode)
  return {
    type: 'command',
    ok,
    message: ok ? `Command verifier passed: ${verifier.command}` : `Command verifier failed: ${verifier.command}`,
    exitCode: result.exitCode,
    stdoutPreview: previewText(result.stdout, 4000),
    stderrPreview: previewText(result.stderr, 4000),
  }
}

async function runFileVerifier(workspaceRoot: string, verifier: Extract<LoopVerification, { type: 'file' }>): Promise<LoopVerificationResult> {
  const path = resolveInside(workspaceRoot, verifier.path)
  const shouldExist = verifier.exists ?? true
  const existsNow = await exists(path)
  if (shouldExist !== existsNow) {
    return {
      type: 'file',
      ok: false,
      message: shouldExist ? `Expected file to exist: ${verifier.path}` : `Expected file to be absent: ${verifier.path}`,
    }
  }
  if (!existsNow) {
    return {
      type: 'file',
      ok: true,
      message: `File absence verified: ${verifier.path}`,
    }
  }
  const text = await readFile(path, 'utf8')
  if (verifier.contains !== undefined && !text.includes(verifier.contains)) {
    return {
      type: 'file',
      ok: false,
      message: `File does not contain expected text: ${verifier.path}`,
      stdoutPreview: previewText(text, 4000),
    }
  }
  if (verifier.notContains !== undefined && text.includes(verifier.notContains)) {
    return {
      type: 'file',
      ok: false,
      message: `File contains forbidden text: ${verifier.path}`,
      stdoutPreview: previewText(text, 4000),
    }
  }
  return {
    type: 'file',
    ok: true,
    message: `File verifier passed: ${verifier.path}`,
    stdoutPreview: previewText(text, 4000),
  }
}

async function runModelVerifier(
  metadata: LoopMetadata,
  finalText: string,
  verifier: Extract<LoopVerification, { type: 'model' }>,
  options: LoopRuntimeRunOptions,
): Promise<LoopVerificationResult> {
  try {
    const model = resolveDefaultModel(options.config ?? {})
    const prompt = [
      verifier.prompt ?? 'Decide whether the loop objective is satisfied. Reply with PASS or FAIL first, then a short reason.',
      '',
      `Objective: ${metadata.objective}`,
      `Success criteria: ${metadata.spec.successCriteria ?? '(not specified)'}`,
      '',
      `Latest agent result:\n${finalText}`,
    ].join('\n')
    const response = await generateText(
      {
        model,
        prompt,
        temperature: 0,
        maxTokens: 256,
      },
      {
        fetch: options.fetch,
      },
    )
    const passText = verifier.passText ?? 'PASS'
    const ok = response.text.toUpperCase().includes(passText.toUpperCase())
    return {
      type: 'model',
      ok,
      message: ok ? 'Model verifier passed.' : 'Model verifier failed.',
      stdoutPreview: previewText(response.text, 4000),
    }
  } catch (error) {
    return {
      type: 'model',
      ok: false,
      message: `Model verifier failed to run: ${errorMessage(error)}`,
    }
  }
}

async function runCustomVerifier(workspaceRoot: string, verifier: Extract<LoopVerification, { type: 'custom' }>): Promise<LoopVerificationResult> {
  if (!verifier.command) {
    return {
      type: 'custom',
      ok: false,
      message: `Custom verifier ${verifier.name} requires a command in v1.`,
    }
  }
  const result = await runShellCommand(verifier.command, workspaceRoot, verifier.timeoutMs ?? 30_000)
  return {
    type: 'custom',
    ok: result.exitCode === 0,
    message: result.exitCode === 0 ? `Custom verifier passed: ${verifier.name}` : `Custom verifier failed: ${verifier.name}`,
    exitCode: result.exitCode,
    stdoutPreview: previewText(result.stdout, 4000),
    stderrPreview: previewText(result.stderr, 4000),
  }
}

function buildIterationPrompt(metadata: LoopMetadata, index: number, feedback: string): string {
  const lines = [
    `You are running Pando Loop ${metadata.loopId}, iteration ${index}.`,
    '',
    'Objective:',
    metadata.objective,
    '',
    'Success criteria:',
    metadata.spec.successCriteria ?? 'Satisfy the objective and pass all configured verifiers.',
    '',
    'Rules:',
    '- Make the smallest concrete change that moves the loop toward passing verification.',
    '- Use tools when files, shell checks, or GUI actions are needed.',
    '- Do not claim completion until the verifier can pass.',
  ]
  if (feedback) {
    lines.push('', 'Previous verifier feedback:', feedback)
  }
  return lines.join('\n')
}

function buildVerificationFeedback(results: readonly LoopVerificationResult[]): string {
  return results
    .filter(result => !result.ok)
    .map(result => [
      `${result.type}: ${result.message}`,
      result.exitCode === undefined ? undefined : `exitCode=${result.exitCode}`,
      result.stdoutPreview ? `stdout:\n${result.stdoutPreview}` : undefined,
      result.stderrPreview ? `stderr:\n${result.stderrPreview}` : undefined,
    ].filter(Boolean).join('\n'))
    .join('\n\n')
}

function loopMaxIterations(spec: LoopSpec): number {
  return Math.max(1, Math.trunc(spec.failurePolicy?.maxIterations ?? spec.maxIterations ?? 3))
}

function loopMaxRuntimeMs(spec: LoopSpec): number | undefined {
  const value = spec.failurePolicy?.maxRuntimeMs ?? spec.maxRuntimeMs
  return value === undefined ? undefined : Math.max(1, Math.trunc(value))
}

function loopMaxConsecutiveFailures(spec: LoopSpec): number {
  return Math.max(1, Math.trunc(spec.failurePolicy?.maxConsecutiveFailures ?? spec.failurePolicy?.maxIterations ?? spec.maxIterations ?? 3))
}

function loopMaxTokens(spec: LoopSpec): number | undefined {
  const value = spec.failurePolicy?.maxTokens
  return value === undefined ? undefined : Math.max(1, Math.trunc(value))
}

function loopManualIntervention(
  spec: LoopSpec,
  input: {
    iterationIndex: number
    consecutiveFailures: number
    feedback: string
    finalText: string
  },
): { reason: string; message: string; policy: NonNullable<LoopFailurePolicy['manualIntervention']> } | undefined {
  const policy = spec.failurePolicy?.manualIntervention
  if (!policy) return undefined
  const afterConsecutiveFailures = positivePolicyInteger(policy.afterConsecutiveFailures)
  if (afterConsecutiveFailures !== undefined && input.consecutiveFailures >= afterConsecutiveFailures) {
    return {
      reason: 'afterConsecutiveFailures',
      message: `after ${input.consecutiveFailures} consecutive failed iteration(s).`,
      policy,
    }
  }
  const afterIterations = positivePolicyInteger(policy.afterIterations)
  if (afterIterations !== undefined && input.iterationIndex >= afterIterations) {
    return {
      reason: 'afterIterations',
      message: `after iteration ${input.iterationIndex}.`,
      policy,
    }
  }
  const matchedPattern = firstMatchingPattern(`${input.feedback}\n${input.finalText}`, policy.failureTextPatterns)
  if (matchedPattern) {
    return {
      reason: 'failureTextPatterns',
      message: `verifier feedback matched "${matchedPattern}".`,
      policy,
    }
  }
  return undefined
}

function positivePolicyInteger(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(1, Math.trunc(value))
}

function firstMatchingPattern(text: string, patterns: readonly string[] | undefined): string | undefined {
  if (!patterns?.length) return undefined
  const lower = text.toLowerCase()
  return patterns.find(pattern => pattern.trim() && lower.includes(pattern.trim().toLowerCase()))
}

function extractUsageTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  for (const key of ['total_tokens', 'totalTokens', 'totalTokenCount', 'total']) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value)
  }
  const input = numericUsageValue(record, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens'])
  const output = numericUsageValue(record, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'])
  if (input !== undefined || output !== undefined) return (input ?? 0) + (output ?? 0)
  return undefined
}

function numericUsageValue(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value)
  }
  return undefined
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolvePromise => {
    const shell = defaultShellCommand(command)
    const child = spawn(shell.command, shell.args, {
      cwd,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let completed = false
    const timeout = setTimeout(() => {
      if (completed) return
      completed = true
      child.kill()
      resolvePromise({
        exitCode: -1,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(),
      })
    }, timeoutMs)
    child.stdout?.on('data', chunk => {
      stdout = `${stdout}${String(chunk)}`.slice(-20_000)
    })
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-20_000)
    })
    child.on('close', code => {
      if (completed) return
      completed = true
      clearTimeout(timeout)
      resolvePromise({
        exitCode: code ?? 0,
        stdout,
        stderr,
      })
    })
    child.on('error', error => {
      if (completed) return
      completed = true
      clearTimeout(timeout)
      resolvePromise({
        exitCode: -1,
        stdout,
        stderr: error.message,
      })
    })
  })
}

async function copyWorkspace(sourceRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  const entries = await readdir(sourceRoot)
  for (const entry of entries) {
    const source = join(sourceRoot, entry)
    if (!isIncludedWorkspacePath(sourceRoot, source)) continue
    const target = join(targetRoot, entry)
    const sourceStat = await stat(source)
    if (sourceStat.isDirectory()) {
      await copyWorkspace(source, target)
      continue
    }
    if (!sourceStat.isFile()) continue
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, await readFile(source, 'utf8'), 'utf8')
  }
}

function isIncludedWorkspacePath(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = relative(sourceRoot, sourcePath)
  if (!relativePath) return true
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return false
  const segments = relativePath.split(/[\\/]+/)
  const ignored = new Set([
    '.git',
    '.pandoshare',
    '.tmp-stability-workspaces',
    'node_modules',
    'dist',
  ])
  if (segments.some(segment => ignored.has(segment))) return false
  const leaf = basename(sourcePath)
  if (leaf.endsWith('.log')) return false
  return true
}

function quoteShellArg(value: string): string {
  if (platform() === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return `'${value.replace(/'/g, "'\\''")}'`
}

function resolveInside(rootPath: string, targetPath: string): string {
  const root = resolve(rootPath)
  const target = isAbsolute(targetPath) ? resolve(targetPath) : resolve(root, targetPath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path is outside loop workspace: ${targetPath}`)
  }
  return target
}

function defaultShellCommand(command: string): { command: string; args: string[] } {
  if (platform() === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    }
  }
  return {
    command: '/bin/sh',
    args: ['-lc', command],
  }
}

async function ensureLoopFiles(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeIfMissing(join(path, STATE_FILE), '')
  await writeIfMissing(join(path, RUNS_FILE), '')
  await writeIfMissing(join(path, ITERATIONS_FILE), '')
  await writeIfMissing(join(path, EVENTS_FILE), '')
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await exists(path)) return
  await writeFile(path, content, 'utf8')
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
  await writeFile(path, values.map(value => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf8')
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  if (!(await exists(path))) return []
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function generateLoopId(now = Date.now()): string {
  return `loop_${now}_${shortId()}`
}

function defaultLoopTitle(loopId: string, objective: string): string {
  return objective ? previewText(objective, 80).replace(/\s+/g, ' ') : loopId
}

function sanitizeLoopId(loopId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(loopId)) throw new Error(`Invalid loopId: ${loopId}`)
  return loopId
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatLoopMarkdown(data: LoopExportData): string {
  const metadata = data.metadata
  const lines = [
    `# ${metadata.title}`,
    '',
    '## Metadata',
    '',
    `- loopId: ${metadata.loopId}`,
    `- status: ${metadata.status}`,
    `- trigger: ${metadata.trigger}`,
    `- cwd: ${metadata.cwd}`,
    `- threadId: ${metadata.threadId ?? 'none'}`,
    `- createdAt: ${formatTime(metadata.createdAtMs)}`,
    `- updatedAt: ${formatTime(metadata.updatedAtMs)}`,
    '',
    '## Objective',
    '',
    metadata.objective,
    '',
    '## State',
    '',
    data.state.trim() || '(empty)',
    '',
    '## Runs',
    '',
  ]
  if (!data.runs.length) {
    lines.push('(none)', '')
  } else {
    data.runs.forEach((run, index) => {
      lines.push(`${index + 1}. ${run.runId} - ${run.status}, iterations=${run.iterationCount}`)
      if (run.finalMessage) lines.push(`   ${run.finalMessage}`)
    })
    lines.push('')
  }
  lines.push('## Iterations', '')
  if (!data.iterations.length) {
    lines.push('(none)', '')
  } else {
    data.iterations.forEach((iteration, index) => {
      lines.push(`${index + 1}. ${iteration.iterationId} - ${iteration.status}`)
      for (const result of iteration.verification) {
        lines.push(`   - ${result.type}: ${result.ok ? 'ok' : 'failed'} - ${result.message}`)
      }
    })
    lines.push('')
  }
  lines.push('## Events', '', `Total events: ${data.events.length}`, '')
  return `${lines.join('\n')}\n`
}

function formatTime(value: number): string {
  return new Date(value).toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
