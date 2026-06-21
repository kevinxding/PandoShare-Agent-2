import type { WorkspaceCleanupResult, WorkspaceDirtyState, WorkspaceLease, WorkspaceLeaseRequest } from './WorkspaceTypes.js'
import { WorktreeManager, type WorktreeManagerOptions } from './WorktreeManager.js'

export type WorkspaceManagerOptions = WorktreeManagerOptions

export class WorkspaceManager {
  private readonly worktrees: WorktreeManager
  private readonly leases = new Map<string, WorkspaceLease>()

  constructor(options: WorkspaceManagerOptions = {}) {
    this.worktrees = new WorktreeManager(options)
  }

  async acquireLease(request: WorkspaceLeaseRequest): Promise<WorkspaceLease> {
    const lease = await this.worktrees.acquireLease(request)
    this.leases.set(lease.leaseId, lease)
    return lease
  }

  async releaseLease(leaseId: string): Promise<WorkspaceCleanupResult> {
    const lease = this.leases.get(leaseId)
    if (!lease) {
      return { leaseId, rootPath: '', removed: false, reason: 'unknown lease' }
    }
    const result = await this.worktrees.cleanupLease(lease)
    this.leases.delete(leaseId)
    return result
  }

  async cleanupExpired(nowMs = Date.now()): Promise<WorkspaceCleanupResult[]> {
    const expired = [...this.leases.values()].filter(lease => lease.expiresAtMs !== undefined && lease.expiresAtMs <= nowMs)
    const results: WorkspaceCleanupResult[] = []
    for (const lease of expired) {
      results.push(await this.releaseLease(lease.leaseId))
    }
    return results
  }

  detectDirty(sourcePath: string): Promise<WorkspaceDirtyState> {
    return this.worktrees.detectDirty(sourcePath)
  }

  listLeases(): WorkspaceLease[] {
    return [...this.leases.values()].sort((left, right) => left.createdAtMs - right.createdAtMs)
  }
}
