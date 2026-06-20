import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { ToolApprovalRequest } from '../../Tool.js'

export type StoredApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type StoredApprovalDecision = 'approve_once' | 'approve_always' | 'reject' | 'cancel'

export type StoredApprovalRecord = {
  schemaVersion: 1
  approvalId: string
  threadId: string
  request: ToolApprovalRequest
  status: StoredApprovalStatus
  createdAtMs: number
  updatedAtMs: number
  decidedAtMs?: number
  decision?: StoredApprovalDecision
  approved?: boolean
  reason?: string
  resolvedBy?: string
}

export type CreateStoredApprovalInput = {
  approvalId: string
  threadId: string
  request: ToolApprovalRequest
  createdAtMs?: number
}

export type ResolveStoredApprovalInput = {
  decision: StoredApprovalDecision
  reason?: string
  resolvedBy?: string
}

export type WaitForStoredApprovalOptions = {
  intervalMs?: number
  signal?: AbortSignal
}

const APPROVALS_DIR = '.pandoshare/approvals'
const APPROVALS_FILE = 'approvals.jsonl'

export class LocalApprovalStore {
  readonly root: string

  constructor(readonly workspaceRoot: string) {
    this.root = resolve(workspaceRoot, APPROVALS_DIR)
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeIfMissing(this.filePath(APPROVALS_FILE), '')
  }

  async createPending(input: CreateStoredApprovalInput): Promise<StoredApprovalRecord> {
    await this.ensure()
    const now = input.createdAtMs ?? Date.now()
    const record: StoredApprovalRecord = {
      schemaVersion: 1,
      approvalId: sanitizeApprovalId(input.approvalId),
      threadId: sanitizeThreadId(input.threadId),
      request: redactApprovalRequest(input.request),
      status: 'pending',
      createdAtMs: now,
      updatedAtMs: now,
    }
    await appendJsonLine(this.filePath(APPROVALS_FILE), record)
    return record
  }

  async resolveApproval(
    approvalId: string,
    input: ResolveStoredApprovalInput,
  ): Promise<StoredApprovalRecord | undefined> {
    await this.ensure()
    const existing = await this.readApproval(approvalId)
    if (!existing) return undefined
    if (existing.status !== 'pending') return existing

    const now = Date.now()
    const approved = input.decision === 'approve_once' || input.decision === 'approve_always'
    const record: StoredApprovalRecord = {
      ...existing,
      status: input.decision === 'cancel' ? 'cancelled' : approved ? 'approved' : 'rejected',
      updatedAtMs: now,
      decidedAtMs: now,
      decision: input.decision,
      approved,
      reason: input.reason ?? defaultDecisionReason(existing.request.toolName, input.decision),
      resolvedBy: input.resolvedBy,
    }
    await appendJsonLine(this.filePath(APPROVALS_FILE), record)
    return record
  }

  async readApproval(approvalId: string): Promise<StoredApprovalRecord | undefined> {
    const records = await this.readApprovals()
    return records.find(record => record.approvalId === approvalId)
  }

  async readApprovals(): Promise<StoredApprovalRecord[]> {
    await this.ensure()
    const latest = new Map<string, StoredApprovalRecord>()
    for (const record of await readJsonLines<StoredApprovalRecord>(this.filePath(APPROVALS_FILE))) {
      latest.set(record.approvalId, record)
    }
    return [...latest.values()].sort((left, right) => right.updatedAtMs - left.updatedAtMs)
  }

  async readPending(): Promise<StoredApprovalRecord[]> {
    return (await this.readApprovals()).filter(record => record.status === 'pending')
  }

  async waitForResolution(
    approvalId: string,
    options: WaitForStoredApprovalOptions = {},
  ): Promise<StoredApprovalRecord> {
    const intervalMs = Math.max(25, options.intervalMs ?? 150)
    while (true) {
      if (options.signal?.aborted) throw new Error(`Approval wait aborted: ${approvalId}`)
      const record = await this.readApproval(approvalId)
      if (!record) throw new Error(`Unknown approval id: ${approvalId}`)
      if (record.status !== 'pending') return record
      await delay(intervalMs)
    }
  }

  filePath(filename: string): string {
    return join(this.root, filename)
  }
}

export function storedApprovalToDecision(record: StoredApprovalRecord): { approved: boolean; reason: string } {
  return {
    approved: record.status === 'approved',
    reason: record.reason ?? defaultDecisionReason(record.request.toolName, record.decision ?? 'reject'),
  }
}

function defaultDecisionReason(toolName: string, decision: StoredApprovalDecision): string {
  switch (decision) {
    case 'approve_always':
      return `Approved ${toolName} for this thread.`
    case 'approve_once':
      return `Approved ${toolName} once.`
    case 'cancel':
      return `Cancelled approval for ${toolName}.`
    case 'reject':
      return `Rejected ${toolName}.`
  }
}

function sanitizeApprovalId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`approvalId must be ASCII: ${value}`)
  return value
}

function sanitizeThreadId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`threadId must be ASCII: ${value}`)
  return value
}

function redactApprovalRequest(request: ToolApprovalRequest): ToolApprovalRequest {
  return {
    ...request,
    toolUse: {
      ...request.toolUse,
      input: redactValue(request.toolUse.input) as Record<string, unknown>,
    },
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') return value
  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? '<redacted>' : redactValue(item)
  }
  return redacted
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return (
    normalized.includes('apikey')
    || normalized.includes('api_key')
    || normalized.includes('token')
    || normalized.includes('password')
    || normalized.includes('secret')
    || normalized.includes('authorization')
  )
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await exists(path)) return
  await writeFile(path, content, 'utf8')
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
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

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}
