import type { GatewayChannelKind, GatewayInboundEnvelope, GatewayOutboundEnvelope } from './GatewayEnvelope.js'

export type GatewayAdapterStatus = 'connected' | 'disconnected' | 'missing_config' | 'failed'
export type GatewayAdapterFailureClass = 'missing_config' | 'temporary' | 'permanent' | 'network' | 'unknown'

export type GatewayAdapterHealth = {
  ok: boolean
  status: GatewayAdapterStatus
  message?: string
  detail?: Record<string, unknown>
}

export type GatewayAdapterSendResult = {
  ok: boolean
  status: 'delivered' | 'queued' | 'failed' | 'skipped'
  message?: string
  failureClass?: GatewayAdapterFailureClass
  retryAfterMs?: number
  externalMessageId?: string
}

export type GatewayChannelAdapterConfig = {
  enabled?: boolean
  tokenEnv?: string
  chatIdEnv?: string
  webhookEnv?: string
  ingressSecretEnv?: string
  failMode?: GatewayAdapterFailureClass
}

export interface GatewayChannelAdapter {
  readonly id: string
  readonly kind: GatewayChannelKind
  readonly supportsInbound: boolean
  readonly supportsOutbound: boolean
  configure(config: GatewayChannelAdapterConfig): void
  connect(): Promise<GatewayAdapterHealth>
  disconnect(): Promise<GatewayAdapterHealth>
  health(): Promise<GatewayAdapterHealth>
  send(outbound: GatewayOutboundEnvelope): Promise<GatewayAdapterSendResult>
  verifyInbound?(request: unknown): Promise<{ ok: boolean; message?: string }>
  normalizeInbound?(raw: unknown): Promise<GatewayInboundEnvelope>
}

export class LocalGatewayChannelAdapter implements GatewayChannelAdapter {
  readonly supportsInbound = true
  readonly supportsOutbound = true
  private connected = false
  private config: GatewayChannelAdapterConfig = {}

  constructor(readonly id = 'local', readonly kind: GatewayChannelKind = 'local') {}

  configure(config: GatewayChannelAdapterConfig): void {
    this.config = config
  }

  async connect(): Promise<GatewayAdapterHealth> {
    if (this.config.enabled === false) return { ok: false, status: 'missing_config', message: 'channel disabled' }
    this.connected = true
    return { ok: true, status: 'connected' }
  }

  async disconnect(): Promise<GatewayAdapterHealth> {
    this.connected = false
    return { ok: true, status: 'disconnected' }
  }

  async health(): Promise<GatewayAdapterHealth> {
    return { ok: this.connected, status: this.connected ? 'connected' : 'disconnected' }
  }

  async send(_outbound: GatewayOutboundEnvelope): Promise<GatewayAdapterSendResult> {
    if (this.config.failMode === 'permanent') return { ok: false, status: 'failed', failureClass: 'permanent', message: 'local permanent failure' }
    if (this.config.failMode === 'temporary' || this.config.failMode === 'network') return { ok: false, status: 'failed', failureClass: this.config.failMode, message: 'local temporary failure' }
    return { ok: true, status: 'delivered', message: 'local delivery recorded' }
  }
}

export class MockGatewayChannelAdapter extends LocalGatewayChannelAdapter {
  constructor(id = 'mock') {
    super(id, 'mock')
  }
}

export class ExternalGatewayChannelAdapter implements GatewayChannelAdapter {
  readonly supportsInbound = true
  readonly supportsOutbound = true
  private config: GatewayChannelAdapterConfig = {}
  private connected = false

  constructor(readonly id: string, readonly kind: GatewayChannelKind) {}

  configure(config: GatewayChannelAdapterConfig): void {
    this.config = config
  }

  async connect(): Promise<GatewayAdapterHealth> {
    const missing = this.missingConfig()
    if (missing) return { ok: false, status: 'missing_config', message: missing }
    this.connected = true
    return { ok: true, status: 'connected' }
  }

  async disconnect(): Promise<GatewayAdapterHealth> {
    this.connected = false
    return { ok: true, status: 'disconnected' }
  }

  async health(): Promise<GatewayAdapterHealth> {
    const missing = this.missingConfig()
    if (missing) return { ok: false, status: 'missing_config', message: missing }
    return { ok: this.connected, status: this.connected ? 'connected' : 'disconnected' }
  }

  async send(_outbound: GatewayOutboundEnvelope): Promise<GatewayAdapterSendResult> {
    const missing = this.missingConfig()
    if (missing) return { ok: false, status: 'failed', failureClass: 'missing_config', message: missing }
    if (this.config.failMode === 'permanent') return { ok: false, status: 'failed', failureClass: 'permanent', message: `${this.kind} permanent failure` }
    if (this.config.failMode === 'temporary' || this.config.failMode === 'network') return { ok: false, status: 'failed', failureClass: this.config.failMode, message: `${this.kind} temporary failure` }
    return { ok: true, status: 'delivered', message: `${this.kind} delivery recorded` }
  }

  private missingConfig(): string | undefined {
    if (this.config.enabled === false) return 'channel disabled'
    if (this.kind === 'telegram') {
      if (!envValue(this.config.tokenEnv)) return 'missing telegram token'
      if (!envValue(this.config.chatIdEnv)) return 'missing telegram chat id'
    }
    if ((this.kind === 'feishu' || this.kind === 'lark' || this.kind === 'wecom') && !envValue(this.config.webhookEnv)) {
      return `missing ${this.kind} webhook`
    }
    return undefined
  }
}

export function createGatewayChannelAdapter(kind: GatewayChannelKind, id = kind): GatewayChannelAdapter {
  if (kind === 'local') return new LocalGatewayChannelAdapter(id, kind)
  if (kind === 'mock') return new MockGatewayChannelAdapter(id)
  return new ExternalGatewayChannelAdapter(id, kind)
}

function envValue(key: string | undefined): string | undefined {
  if (!key) return undefined
  const runtime = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env?.[key]
}
