import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { WorkspaceCleanupResult, WorkspaceDirtyState, WorkspaceLease, WorkspaceLeaseRequest } from './WorkspaceTypes.js'

export type WorktreeManagerOptions = {
  tempRoot?: string
  copyExcludes?: readonly string[]
}

const DEFAULT_EXCLUDES = new Set(['.git', 'node_modules', 'dist', '.tmp-stability-workspaces', '.tmp-task-debug', '.tmp-visual-qa'])
let leaseCounter = 0

export class WorktreeManager {
  private readonly tempRoot: string
  private readonly copyExcludes: Set<string>

  constructor(options: WorktreeManagerOptions = {}) {
    this.tempRoot = resolve(options.tempRoot ?? '.tmp-workspaces')
    this.copyExcludes = new Set([...DEFAULT_EXCLUDES, ...(options.copyExcludes ?? [])])
  }

  async acquireLease(request: WorkspaceLeaseRequest): Promise<WorkspaceLease> {
    const sourcePath = resolve(request.sourcePath)
    const tempRoot = resolve(request.tempRoot ?? this.tempRoot)
    const leaseId = safeLeaseId(request.leaseId ?? createLeaseId())
    const rootPath = join(tempRoot, leaseId)
    const createdAtMs = Date.now()
    const dirtyAtAcquire = await this.detectDirty(sourcePath)
    await mkdir(tempRoot, { recursive: true })
    await rm(rootPath, { recursive: true, force: true })

    if (request.preferGitWorktree !== false && dirtyAtAcquire.isGitRepo && !dirtyAtAcquire.dirty) {
      const result = await this.tryGitWorktree(sourcePath, rootPath)
      if (result.ok) return { leaseId, mode: 'git_worktree', sourcePath, rootPath, createdAtMs, expiresAtMs: request.ttlMs ? createdAtMs + request.ttlMs : undefined, dirtyAtAcquire }
      await this.copyFallback(sourcePath, rootPath)
      return { leaseId, mode: 'temp_copy', sourcePath, rootPath, createdAtMs, expiresAtMs: request.ttlMs ? createdAtMs + request.ttlMs : undefined, dirtyAtAcquire, fallbackReason: result.reason }
    }

    await this.copyFallback(sourcePath, rootPath)
    return { leaseId, mode: 'temp_copy', sourcePath, rootPath, createdAtMs, expiresAtMs: request.ttlMs ? createdAtMs + request.ttlMs : undefined, dirtyAtAcquire, fallbackReason: dirtyAtAcquire.isGitRepo && dirtyAtAcquire.dirty ? 'source tree is dirty' : 'git worktree not requested or unavailable' }
  }

  async cleanupLease(lease: WorkspaceLease): Promise<WorkspaceCleanupResult> {
    const rootPath = resolve(lease.rootPath)
    if (!isInside(rootPath, resolve(this.tempRoot))) return { leaseId: lease.leaseId, rootPath, removed: false, reason: 'lease root is outside manager tempRoot' }
    if (lease.mode === 'git_worktree') await runCommand('git', ['-C', lease.sourcePath, 'worktree', 'remove', '--force', rootPath]).catch(() => undefined)
    await rm(rootPath, { recursive: true, force: true })
    return { leaseId: lease.leaseId, rootPath, removed: !(await exists(rootPath)) }
  }

  async detectDirty(sourcePath: string): Promise<WorkspaceDirtyState> {
    const rootPath = resolve(sourcePath)
    if (!(await exists(join(rootPath, '.git')))) return { isGitRepo: false, dirty: false, files: [], reason: 'no .git directory' }
    const result = await runCommand('git', ['-C', rootPath, 'status', '--porcelain=v1'])
    if (result.exitCode !== 0) return { isGitRepo: true, dirty: true, files: [], reason: result.stderr.trim() || 'git status failed' }
    const files = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    return { isGitRepo: true, dirty: files.length > 0, files }
  }

  private async tryGitWorktree(sourcePath: string, rootPath: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await runCommand('git', ['-C', sourcePath, 'worktree', 'add', '--detach', rootPath, 'HEAD'])
    return result.exitCode === 0 ? { ok: true } : { ok: false, reason: result.stderr.trim() || 'git worktree add failed' }
  }

  private async copyFallback(sourcePath: string, rootPath: string): Promise<void> {
    await copyDirectory(resolve(sourcePath), resolve(rootPath), this.copyExcludes)
  }
}

async function copyDirectory(sourceRoot: string, targetRoot: string, excludes: Set<string>): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  for (const entry of await readdir(sourceRoot)) {
    if (excludes.has(entry)) continue
    const source = join(sourceRoot, entry)
    const target = join(targetRoot, entry)
    const info = await stat(source)
    if (info.isDirectory()) await copyDirectory(source, target, excludes)
    else if (info.isFile()) {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await readFile(source, 'utf8'), 'utf8')
    }
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

function safeLeaseId(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || createLeaseId()
}

function createLeaseId(): string {
  leaseCounter += 1
  return 'lease_' + Date.now().toString(36) + '_' + leaseCounter
}

function isInside(targetPath: string, rootPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!!rel && !rel.startsWith('..'))
}

function runCommand(command: string, args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolveRun => {
    const child = spawn(command, [...args], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => resolveRun({ exitCode: 1, stdout, stderr: error.message }))
    child.on('close', code => resolveRun({ exitCode: code ?? 1, stdout, stderr }))
  })
}
