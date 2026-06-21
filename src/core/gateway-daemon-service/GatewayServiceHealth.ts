import type { GatewayHealthSnapshot } from '../gateway/index.js'
import { DaemonHealth } from '../daemon/index.js'
import type { DaemonHealthReport } from '../daemon/index.js'
import type { GatewayServiceConfig } from './GatewayServiceConfig.js'

export type GatewayServiceHealthReport = {
  ok: boolean
  daemon: DaemonHealthReport
  gateway?: GatewayHealthSnapshot
  message: string
}

export async function readGatewayServiceHealth(input: GatewayServiceConfig & { gatewayHealth?: () => Promise<GatewayHealthSnapshot> }): Promise<GatewayServiceHealthReport> {
  const daemon = await new DaemonHealth({
    workspaceRoot: input.workspaceRoot,
    workspaceId: input.workspaceId,
    daemonId: input.runtimeId ?? 'gateway-service',
    runtimeId: input.runtimeId ?? 'gateway-service',
    workerType: 'gateway',
  }).report({ staleAfterMs: input.staleAfterMs })
  const gateway = input.gatewayHealth ? await input.gatewayHealth() : undefined
  return {
    ok: daemon.ok && (gateway ? gateway.status !== 'failed' : true),
    daemon,
    gateway,
    message: gateway ? `${daemon.message} gateway=${gateway.status}` : daemon.message,
  }
}
