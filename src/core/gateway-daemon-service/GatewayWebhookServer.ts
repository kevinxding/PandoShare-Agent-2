import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { GatewayServiceRuntime } from './GatewayServiceRuntime.js'

export type GatewayWebhookServerOptions = {
  runtime: Pick<GatewayServiceRuntime, 'receiveWebhookInbound'>
  ingressSecret: string
  host?: string
  port?: number
  allowNonMockChannel?: boolean
  maxBodyBytes?: number
}

export type GatewayWebhookServerHandle = {
  host: string
  port: number
  url: string
  close(): Promise<void>
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const SECRET_HEADER = 'x-pando-gateway-secret'

export class GatewayWebhookServer {
  private server?: Server

  constructor(private readonly input: GatewayWebhookServerOptions) {
    if (!input.ingressSecret || !input.ingressSecret.trim()) {
      throw new Error('Gateway webhook server requires a non-empty ingress secret.')
    }
    const host = input.host ?? DEFAULT_HOST
    if (!isLocalHost(host)) {
      throw new Error(`Gateway webhook server must bind to a local host, got ${host}.`)
    }
  }

  async start(): Promise<GatewayWebhookServerHandle> {
    if (this.server) throw new Error('Gateway webhook server is already started.')
    const host = this.input.host ?? DEFAULT_HOST
    const port = this.input.port ?? 0
    const server = createServer((request, response) => {
      this.handle(request, response).catch(() => sendJson(response, 500, { ok: false, error: 'server_error' }))
    })
    await listen(server, port, host)
    this.server = server
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Gateway webhook server failed to bind.')
    return {
      host,
      port: address.port,
      url: `http://${host}:${address.port}`,
      close: () => this.close(),
    }
  }

  async close(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = undefined
    await new Promise<void>((resolvePromise, reject) => {
      server.close(error => error ? reject(error) : resolvePromise())
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/gateway/inbound') {
      sendJson(response, 404, { ok: false, error: 'not_found' })
      return
    }
    if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' })
      return
    }
    if (!this.isAuthorized(request)) {
      sendJson(response, 401, { ok: false, error: 'unauthorized' })
      return
    }

    const bodyText = await readBody(request, this.input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
    let body: Record<string, unknown>
    try {
      const parsed = JSON.parse(bodyText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
      body = parsed as Record<string, unknown>
    } catch {
      sendJson(response, 400, { ok: false, error: 'invalid_json' })
      return
    }

    const inbound = normalizeInbound(body)
    if (!inbound.ok) {
      sendJson(response, 400, { ok: false, error: inbound.error })
      return
    }
    if (!this.input.allowNonMockChannel && (inbound.channelId !== 'mock' || inbound.channelKind !== 'mock')) {
      sendJson(response, 400, { ok: false, error: 'unsupported_channel' })
      return
    }

    const queued = await this.input.runtime.receiveWebhookInbound(inbound)
    sendJson(response, 202, { ok: true, ...queued })
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const secret = this.input.ingressSecret
    const header = firstHeader(request.headers[SECRET_HEADER])
    if (header === secret) return true
    const authorization = firstHeader(request.headers.authorization)
    return authorization === `Bearer ${secret}`
  }
}

function normalizeInbound(body: Record<string, unknown>):
  | { ok: true; channelId: string; channelKind: 'mock'; userId: string; text: string; externalMessageId?: string; createdAtMs?: number; metadata?: Record<string, unknown> }
  | { ok: false; error: string } {
  const text = stringField(body.text)
  const userId = stringField(body.userId) ?? stringField(body.user)
  const channelId = stringField(body.channelId) ?? 'mock'
  const channelKind = stringField(body.channelKind) ?? 'mock'
  if (!text || !userId) return { ok: false, error: 'invalid_inbound' }
  if (channelKind !== 'mock') return { ok: false, error: 'unsupported_channel' }
  const createdAtMs = typeof body.createdAtMs === 'number' ? body.createdAtMs : undefined
  const metadata = recordField(body.metadata)
  return {
    ok: true,
    channelId,
    channelKind,
    userId,
    text,
    externalMessageId: stringField(body.externalMessageId) ?? stringField(body.messageId),
    createdAtMs,
    metadata,
  }
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = ''
    request.on('data', chunk => {
      body += String(chunk)
      if (body.length > maxBytes) reject(new Error('request body too large'))
    })
    request.on('end', () => resolvePromise(body))
    request.on('error', reject)
  })
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false
    server.listen(port, host, () => {
      settled = true
      resolvePromise()
    })
    setTimeout(() => {
      if (!settled) reject(new Error('Gateway webhook server listen timed out.'))
    }, 5000)
  })
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(value)}\n`)
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}
