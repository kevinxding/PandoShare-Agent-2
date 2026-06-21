export type WorkspaceLeaseMode = 'git_worktree' | 'temp_copy'

export type WorkspaceDirtyState = {
  isGitRepo: boolean
  dirty: boolean
  files: string[]
  reason?: string
}

export type WorkspaceLease = {
  leaseId: string
  mode: WorkspaceLeaseMode
  sourcePath: string
  rootPath: string
  createdAtMs: number
  expiresAtMs?: number
  dirtyAtAcquire: WorkspaceDirtyState
  fallbackReason?: string
}

export type WorkspaceLeaseRequest = {
  sourcePath: string
  leaseId?: string
  ttlMs?: number
  preferGitWorktree?: boolean
  tempRoot?: string
}

export type WorkspaceCleanupResult = {
  leaseId: string
  rootPath: string
  removed: boolean
  reason?: string
}
