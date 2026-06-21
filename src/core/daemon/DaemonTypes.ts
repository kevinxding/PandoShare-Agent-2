export type DaemonStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed'

export type DaemonMarkerKind = 'stop' | 'crash'

export type DaemonRuntimeIdentity = {
  workspaceRoot: string
  workspaceId?: string
  daemonId?: string
  runtimeId?: string
}

export type DaemonPaths = {
  workspaceRoot: string
  workspaceId: string
  daemonId: string
  runtimeId: string
  pidPath: string
  stopMarkerPath: string
  crashMarkerPath: string
}

export type DaemonPidRecord = {
  schemaVersion: 1
  daemonId: string
  workspaceId: string
  runtimeId: string
  pid: number
  status: DaemonStatus
  startedAtMs: number
  updatedAtMs: number
  cwd: string
  pidPath: string
  stopMarkerPath: string
  crashMarkerPath: string
  heartbeatWorkerId: string
  command?: string
  message?: string
}

export type DaemonPidInspection = {
  status: 'missing' | 'active' | 'stale'
  stale: boolean
  record?: DaemonPidRecord
  message: string
}

export type DaemonMarkerRecord = {
  schemaVersion: 1
  kind: DaemonMarkerKind
  daemonId: string
  workspaceId: string
  runtimeId: string
  pid?: number
  reason: string
  createdAtMs: number
  message?: string
}

export type DaemonHeartbeatStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'stopped' | 'stale' | 'failed'

export type DaemonHeartbeatSnapshot = {
  workerId: string
  status: DaemonHeartbeatStatus
  lastHeartbeatAtMs: number
  pid?: number
  message?: string
}

export type DaemonHealthReport = {
  ok: boolean
  status: 'not_started' | 'healthy' | 'stale' | 'stopped' | 'failed' | 'unknown'
  stale: boolean
  staleAfterMs: number
  heartbeatAgeMs?: number
  pid?: DaemonPidInspection
  heartbeat?: DaemonHeartbeatSnapshot
  message: string
}

export type DaemonWatchdogReport = DaemonHealthReport & {
  markedStale: boolean
}

export type DaemonRunSignal = {
  readonly stopRequested: boolean
  readonly stopReason?: string
}

export type DaemonForegroundRunResult = {
  pid: DaemonPidRecord
  health: DaemonHealthReport
  status: DaemonStatus
  stoppedBySignal: boolean
}
