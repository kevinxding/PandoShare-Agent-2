import { spawn, type ChildProcess } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { defaultShellCommand, limitedText, toPortablePath } from '../tools/shared/index.js'

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped'

export type TaskRecord = {
  taskId: string
  title: string
  status: TaskStatus
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
}

export type CreateTaskInput = {
  taskId?: string
  title?: string
  command?: string
  cwd: string
  goalId?: string
  threadId?: string
  loopId?: string
}

export type UpdateTaskInput = {
  status?: TaskStatus
  summary?: string
}

const activeChildren = new Map<string, ChildProcess>()
const outputWrites = new Map<string, Promise<void>>()

export class LocalTaskStore {
  readonly root: string

  constructor(readonly workspaceRoot: string) {
    this.root = join(workspaceRoot, '.pandoshare', 'tasks')
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const now = Date.now()
    const taskId = sanitizeTaskId(input.taskId ?? `task_${now}_${shortId()}`)
    const taskDir = this.taskPath(taskId)
    await mkdir(taskDir, { recursive: true })
    const record: TaskRecord = {
      taskId,
      title: input.title?.trim() || input.command?.slice(0, 80) || taskId,
      status: input.command ? 'running' : 'queued',
      cwd: resolve(input.cwd),
      command: input.command,
      createdAtMs: now,
      updatedAtMs: now,
      startedAtMs: input.command ? now : undefined,
      goalId: optionalAscii(input.goalId),
      threadId: optionalAscii(input.threadId),
      loopId: optionalAscii(input.loopId),
      outputPath: toPortablePath(join('.pandoshare', 'tasks', taskId, 'output.log')),
      outputChars: 0,
    }
    await this.writeTask(record)
    await writeFile(this.outputFile(taskId), '', 'utf8')
    if (input.command) this.startProcess(record)
    return record
  }

  async listTasks(): Promise<TaskRecord[]> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root)
    const records: TaskRecord[] = []
    for (const entry of entries) {
      if (!(await safeIsDirectory(join(this.root, entry)))) continue
      try {
        records.push(await this.readTask(entry))
      } catch {
        // Ignore partial task folders left by interrupted runs.
      }
    }
    return records.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }

  async readTask(taskId: string): Promise<TaskRecord> {
    const text = await readFile(this.metadataFile(taskId), 'utf8')
    return JSON.parse(text) as TaskRecord
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<TaskRecord> {
    const record = await this.readTask(taskId)
    const next: TaskRecord = {
      ...record,
      ...(input.status ? { status: input.status } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      updatedAtMs: Date.now(),
    }
    if ((input.status === 'completed' || input.status === 'failed' || input.status === 'stopped') && !next.completedAtMs) {
      next.completedAtMs = Date.now()
    }
    await this.writeTask(next)
    return next
  }

  async readOutput(taskId: string, maxChars = 20_000): Promise<{ text: string; truncated: boolean }> {
    const text = await readFile(this.outputFile(taskId), 'utf8')
    return limitedText(text, maxChars)
  }

  async stopTask(taskId: string, reason = 'Task stopped.'): Promise<TaskRecord> {
    const child = activeChildren.get(sanitizeTaskId(taskId))
    if (child) {
      child.kill('SIGTERM')
      activeChildren.delete(taskId)
    }
    await this.queueAppendOutput(taskId, `\n[stopped] ${reason}\n`)
    return this.updateTask(taskId, { status: 'stopped', summary: reason })
  }

  taskPath(taskId: string): string {
    return join(this.root, sanitizeTaskId(taskId))
  }

  private metadataFile(taskId: string): string {
    return join(this.taskPath(taskId), 'metadata.json')
  }

  private outputFile(taskId: string): string {
    return join(this.taskPath(taskId), 'output.log')
  }

  private async writeTask(record: TaskRecord): Promise<void> {
    await mkdir(dirname(this.metadataFile(record.taskId)), { recursive: true })
    await writeFile(this.metadataFile(record.taskId), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  }

  private async appendOutput(taskId: string, text: string): Promise<void> {
    await appendFile(this.outputFile(taskId), text, 'utf8')
    const record = await this.readTask(taskId)
    await this.writeTask({
      ...record,
      outputChars: record.outputChars + text.length,
      updatedAtMs: Date.now(),
    })
  }

  private queueAppendOutput(taskId: string, text: string): Promise<void> {
    const previous = outputWrites.get(taskId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.appendOutput(taskId, text))
    outputWrites.set(taskId, next)
    return next
  }

  private startProcess(record: TaskRecord): void {
    const shell = defaultShellCommand(record.command ?? '')
    const child = spawn(shell.command, shell.args, {
      cwd: record.cwd,
      windowsHide: true,
      env: runtimeEnv(),
    })
    activeChildren.set(record.taskId, child)
    child.stdout?.on('data', chunk => {
      void this.queueAppendOutput(record.taskId, String(chunk))
    })
    child.stderr?.on('data', chunk => {
      void this.queueAppendOutput(record.taskId, String(chunk))
    })
    child.on('error', error => {
      activeChildren.delete(record.taskId)
      void this.queueAppendOutput(record.taskId, `\n[error] ${error.message}\n`)
      void this.updateTask(record.taskId, { status: 'failed', summary: error.message })
    })
    child.on('close', (exitCode, signal) => {
      activeChildren.delete(record.taskId)
      void this.finalizeTask(record.taskId, exitCode, signal)
    })
  }

  private async finalizeTask(taskId: string, exitCode: number | null, signal: string | null): Promise<void> {
    await outputWrites.get(taskId)
    outputWrites.delete(taskId)
    const record = await this.readTask(taskId)
    if (record.status === 'stopped') return
    const status: TaskStatus = exitCode === 0 ? 'completed' : 'failed'
    await this.writeTask({
      ...record,
      status,
      exitCode,
      signal,
      completedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      summary: status === 'completed' ? 'Task completed.' : `Task failed with exit code ${exitCode ?? 'null'}.`,
    })
  }
}

function sanitizeTaskId(taskId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error(`Invalid taskId: ${taskId}`)
  return taskId
}

function optionalAscii(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid id: ${value}`)
  return value
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8)
}

async function safeIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function runtimeEnv(): Record<string, string | undefined> {
  const runtime = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env ?? {}
}
