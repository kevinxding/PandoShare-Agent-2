import type { BackendAction, BackendResponse, BackendService } from '../backend/index.js'

export type MissionControlAction =
  | 'agent.stop'
  | 'loop.runNext'
  | 'loop.recover'
  | 'gateway.tick'
  | 'gateway.retryOutbound'
  | 'gui.releaseInput'
  | 'gui.approve'
  | 'gui.reject'
  | 'model.route'
  | 'replay.export'
  | 'system.health'

export type MissionControlOptions = {
  workspaceRoot: string
  cwd?: string
  sessionId?: string
  backend?: BackendService
  now?: () => number
}

export type MissionControlQuery = {
  limit?: number
  status?: string
}

export type MissionControlResponse<TData = unknown> = {
  requestId: string
  ok: boolean
  data: TData
  warnings: string[]
  eventIds: string[]
}

export type MissionControlActionRequest = {
  action: MissionControlAction | string
  payload?: Record<string, unknown>
  requestId?: string
}

export type MissionControlActionResult = {
  action: string
  backendAction: BackendAction
  backend: BackendResponse
}

export type MissionControlHealthState = 'ok' | 'degraded' | 'blocked'

export type MissionControlOverview = {
  workspace: Record<string, unknown>
  agent: Record<string, unknown>
  durable: Record<string, unknown>
  loop: Record<string, unknown>
  gui: Record<string, unknown>
  gateway: Record<string, unknown>
  model: Record<string, unknown>
  replay: Record<string, unknown>
  health: { status: MissionControlHealthState; checks: Array<Record<string, unknown>> }
  approvals: Record<string, unknown>
  cost: Record<string, unknown>
  recentIncidents: Array<Record<string, unknown>>
  recentEvents: Array<Record<string, unknown>>
}

export type MissionControlActiveWork = {
  activeRuns: Array<Record<string, unknown>>
  activeLoops: Array<Record<string, unknown>>
  pendingApprovals: Array<Record<string, unknown>>
  activeGuiActions: Array<Record<string, unknown>>
  gatewayQueue: Array<Record<string, unknown>>
  modelRateLimits: Array<Record<string, unknown>>
  staleHeartbeats: Array<Record<string, unknown>>
  recoveryRequired: Array<Record<string, unknown>>
}
