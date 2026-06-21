import { compactEvents } from './MissionControlEvents.js'
import type { MissionControlActiveWork, MissionControlHealthState, MissionControlOverview } from './MissionControlTypes.js'

export type MissionControlSnapshotInput = {
  workspaceRoot: string
  nowMs: number
  backendStatus: Record<string, unknown>
}

export class MissionControlProjector {
  overview(input: MissionControlSnapshotInput): MissionControlOverview {
    const checks = this.healthChecks(input)
    return {
      workspace: { root: input.workspaceRoot, store: '.pandoshare', nowMs: input.nowMs },
      agent: { status: 'idle', source: 'mission-control-backend' },
      durable: { status: 'baseline', store: '.pandoshare' },
      loop: { status: 'baseline', activeCount: 0 },
      gui: { status: 'baseline', activeActions: 0, realGuiRequiresEnv: 'PANDO_GUI_REAL=1' },
      gateway: { status: 'baseline', queuedOutboundCount: 0 },
      model: { status: 'baseline', onlineProbeRequiresEnv: 'PANDO_MODEL_PROBE_ONLINE=1' },
      replay: { status: 'baseline', goldenTraces: 'available' },
      health: { status: healthStatus(checks), checks },
      approvals: { pendingCount: 0, dangerousActionsRequireApproval: true },
      cost: { currency: 'unknown', estimatedThisRun: 0, source: 'baseline' },
      recentIncidents: [],
      recentEvents: compactEvents([input.backendStatus], 10),
    }
  }

  activeWork(): MissionControlActiveWork {
    return { activeRuns: [], activeLoops: [], pendingApprovals: [], activeGuiActions: [], gatewayQueue: [], modelRateLimits: [], staleHeartbeats: [], recoveryRequired: [] }
  }

  private healthChecks(input: MissionControlSnapshotInput): Array<Record<string, unknown>> {
    return [
      { id: 'workspace', status: 'ok', message: 'Workspace root resolved.', detail: { root: input.workspaceRoot } },
      { id: 'backend', status: input.backendStatus.ok === true ? 'ok' : 'degraded', message: 'BackendService status boundary is reachable.' },
      { id: 'security', status: 'baseline', message: 'Mission Control only exposes redacted local-dev state.' },
    ]
  }
}

function healthStatus(checks: Array<Record<string, unknown>>): MissionControlHealthState {
  if (checks.some(check => check.status === 'blocked')) return 'blocked'
  if (checks.some(check => check.status === 'degraded')) return 'degraded'
  return 'ok'
}
