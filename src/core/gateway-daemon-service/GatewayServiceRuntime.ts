import { DaemonCommand, DaemonHealth, DaemonProcess, type DaemonForegroundRunResult } from '../daemon/index.js'
import { GatewayDaemon, type GatewayDaemonOptions, type GatewayInboundInput, type GatewayTickResult } from '../gateway/index.js'
import { createDefaultGatewayServiceAdapters, normalizeGatewayServiceConfig, type GatewayServiceConfig, type NormalizedGatewayServiceConfig } from './GatewayServiceConfig.js'
import { readGatewayServiceHealth, type GatewayServiceHealthReport } from './GatewayServiceHealth.js'

export type GatewayServiceTickSummary = GatewayTickResult & {
  tickIndex: number
}

export type GatewayServiceRunOptions = {
  maxTicks?: number
  intervalMs?: number
  continuous?: boolean
}

export type GatewayServiceRunResult = {
  pid: DaemonForegroundRunResult['pid']
  health: GatewayServiceHealthReport
  ticks: GatewayServiceTickSummary[]
  stoppedBySignal: boolean
}

export class GatewayServiceRuntime {
  readonly config: NormalizedGatewayServiceConfig
  readonly gateway: GatewayDaemon
  readonly process: DaemonProcess
  readonly command: DaemonCommand
  readonly health: DaemonHealth

  constructor(input: GatewayServiceConfig & { gateway?: GatewayDaemon }) {
    this.config = normalizeGatewayServiceConfig(input)
    this.gateway = input.gateway ?? new GatewayDaemon(this.gatewayOptions())
    const identity = {
      workspaceRoot: this.config.workspaceRoot,
      workspaceId: this.config.workspaceId,
      daemonId: this.config.runtimeId,
      runtimeId: this.config.runtimeId,
      workerType: 'gateway' as const,
    }
    this.process = new DaemonProcess(identity)
    this.command = new DaemonCommand(identity)
    this.health = new DaemonHealth(identity)
  }

  async receiveWebhookInbound(input: Omit<GatewayInboundInput, 'channelId' | 'channelKind'> & { channelId?: string; channelKind?: 'mock' }): Promise<{ inboundId: string; duplicate: boolean; denied: boolean }> {
    const result = await this.gateway.receiveInbound({
      ...input,
      channelId: input.channelId ?? 'mock',
      channelKind: 'mock',
      signatureVerified: true,
      metadata: {
        ...input.metadata,
        source: 'gateway_webhook_server',
      },
    })
    return {
      inboundId: result.envelope.inboundId,
      duplicate: result.duplicate,
      denied: result.denied,
    }
  }

  async tick(tickIndex = 0): Promise<GatewayServiceTickSummary> {
    const result = await this.gateway.tick({
      maxInbound: this.config.maxInboundPerTick,
      maxOutbound: this.config.maxOutboundPerTick,
    })
    await this.health.writeHeartbeat({
      status: 'running',
      message: `Gateway service tick ${tickIndex}.`,
      metadata: {
        tickIndex,
        inboundProcessed: result.inboundProcessed,
        outboundProcessed: result.outboundProcessed,
        queuedOutboundCount: result.health.queuedOutboundCount,
        retryOutboundCount: result.health.retryOutboundCount,
      },
    })
    return {
      tickIndex,
      ...result,
    }
  }

  async run(options: GatewayServiceRunOptions = {}): Promise<GatewayServiceRunResult> {
    const ticks: GatewayServiceTickSummary[] = []
    let stoppedBySignal = false
    const foreground = await this.process.runForeground({
      command: 'gateway-service',
      staleAfterMs: this.config.staleAfterMs,
      run: async () => {
        await this.gateway.start({ reason: 'Gateway service runtime started.' })
        try {
          const maxTicks = options.maxTicks ?? this.config.maxTicks ?? (options.continuous || this.config.continuous ? undefined : 1)
          const intervalMs = Math.max(0, options.intervalMs ?? this.config.intervalMs)
          let tickIndex = 0
          while (true) {
            const stopMarker = await this.command.readStopMarker()
            if (stopMarker) {
              stoppedBySignal = true
              break
            }
            ticks.push(await this.tick(tickIndex))
            tickIndex += 1
            if (maxTicks !== undefined && tickIndex >= maxTicks) break
            if (maxTicks === undefined && !(options.continuous || this.config.continuous)) break
            if (intervalMs > 0) await delay(intervalMs)
          }
        } finally {
          await this.gateway.stop(stoppedBySignal ? 'Gateway service stopped by stop marker.' : 'Gateway service runtime stopped.')
        }
      },
    })
    return {
      pid: foreground.pid,
      health: await this.readHealth(),
      ticks,
      stoppedBySignal: foreground.stoppedBySignal || stoppedBySignal,
    }
  }

  async requestStop(reason = 'gateway service stop requested'): Promise<void> {
    await this.command.requestStop(reason)
  }

  readHealth(): Promise<GatewayServiceHealthReport> {
    return readGatewayServiceHealth({
      ...this.config,
      gatewayHealth: () => this.gateway.health(),
    })
  }

  private gatewayOptions(): GatewayDaemonOptions {
    return {
      workspaceRoot: this.config.workspaceRoot,
      workspaceId: this.config.workspaceId,
      runtimeId: 'gateway',
      gatewayId: this.config.gatewayId,
      sessionId: this.config.sessionId,
      source: 'daemon',
      adapters: this.config.adapters ?? createDefaultGatewayServiceAdapters({ outboundFailureMode: this.config.outboundFailureMode }),
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

