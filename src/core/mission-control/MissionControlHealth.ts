import type { MissionControlOverview } from './MissionControlTypes.js'

export function summarizeMissionControlHealth(overview: MissionControlOverview): Record<string, unknown> {
  return {
    status: overview.health.status,
    checkCount: overview.health.checks.length,
    degradedCount: overview.health.checks.filter(check => check.status === 'degraded').length,
    blockedCount: overview.health.checks.filter(check => check.status === 'blocked').length,
  }
}
