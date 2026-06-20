import { spawn, type ChildProcess } from 'node:child_process'

import type { McpResourceInfo, McpServerConfig, McpServerInfo, McpToolInfo } from './types.js'

type JsonRpcResponse = {
  id?: number | string
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

type StdioChildProcess = ChildProcess & {
  stdin?: {
    write(text: string): void
  }
  stdout?: {
    setEncoding?(encoding: string): void
    on(event: 'data', listener: (chunk: unknown) => void): void
  }
  stderr?: {
    setEncoding?(encoding: string): void
    on(event: 'data', listener: (chunk: unknown) => void): void
  }
}

export class StdioMcpClient {
  private child?: StdioChildProcess
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private stdoutBuffer = ''

  constructor(
    readonly serverName: string,
    readonly config: McpServerConfig,
  ) {}

  async connect(): Promise<McpServerInfo | undefined> {
    if (this.child) throw new Error(`MCP server already started: ${this.serverName}`)
    this.child = spawn(this.config.command, [...(this.config.args ?? [])], {
      windowsHide: true,
    }) as StdioChildProcess
    if (!this.child.stdin || !this.child.stdout) throw new Error(`MCP server stdio is unavailable: ${this.serverName}`)
    this.child.stdout.setEncoding?.('utf8')
    this.child.stdout.on('data', (chunk: unknown) => this.handleStdout(String(chunk)))
    this.child.stderr?.setEncoding?.('utf8')
    this.child.on('close', (code: number | null, signal: string | null) => {
      const message = `MCP server exited: ${this.serverName} code=${code ?? 'none'} signal=${signal ?? 'none'}`
      this.rejectAll(new Error(message))
    })
    this.child.on('error', (error: Error) => this.rejectAll(error))

    const result = await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'pando',
          version: '0.1.0',
        },
      },
      startupTimeoutMs(this.config),
    )
    this.notify('notifications/initialized', {})
    return parseServerInfo(result)
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request('tools/list', {})
    const tools = (result as { tools?: unknown }).tools
    if (!Array.isArray(tools)) return []
    return tools.flatMap(tool => {
      if (!tool || typeof tool !== 'object') return []
      const record = tool as Record<string, unknown>
      if (typeof record.name !== 'string' || !record.name) return []
      return [
        {
          name: record.name,
          description: typeof record.description === 'string' ? record.description : undefined,
          inputSchema: isRecord(record.inputSchema) ? record.inputSchema : undefined,
        },
      ]
    })
  }

  async listResources(): Promise<McpResourceInfo[]> {
    const result = await this.request('resources/list', {})
    const resources = (result as { resources?: unknown }).resources
    if (!Array.isArray(resources)) return []
    return resources.flatMap(resource => {
      if (!resource || typeof resource !== 'object') return []
      const record = resource as Record<string, unknown>
      if (typeof record.uri !== 'string' || !record.uri) return []
      return [
        {
          uri: record.uri,
          name: typeof record.name === 'string' ? record.name : undefined,
          description: typeof record.description === 'string' ? record.description : undefined,
          mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
        },
      ]
    })
  }

  readResource(uri: string): Promise<unknown> {
    return this.request('resources/read', { uri })
  }

  callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', {
      name,
      arguments: input,
    })
  }

  close(): void {
    this.rejectAll(new Error(`MCP server closed: ${this.serverName}`))
    this.child?.kill()
    this.child = undefined
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
    const child = this.requireChild()
    const id = this.nextId++
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }
    const message = JSON.stringify(payload)
    const timeout = setTimeout(() => {
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      pending.reject(new Error(`MCP request timed out: ${this.serverName} ${method}`))
    }, timeoutMs)

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timeout })
    })
    this.writeMessage(message)
    return promise
  }

  private notify(method: string, params: Record<string, unknown>): void {
    const child = this.requireChild()
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    })
    this.writeMessage(message)
  }

  private requireChild(): StdioChildProcess {
    if (!this.child) throw new Error(`MCP server is not started: ${this.serverName}`)
    return this.child
  }

  private writeMessage(message: string): void {
    const child = this.requireChild()
    if (this.config.messageFormat === 'json-lines') {
      child.stdin?.write(`${message}\n`)
      return
    }
    child.stdin?.write(`Content-Length: ${utf8ByteLength(message)}\r\n\r\n${message}`)
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const framed = readContentLengthFrame(this.stdoutBuffer)
      if (framed) {
        this.stdoutBuffer = framed.rest
        this.handleMessage(framed.body)
        continue
      }

      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline === -1) return
      const line = this.stdoutBuffer.slice(0, newline).trim()
      if (!line || line.toLowerCase().startsWith('content-length:')) return
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      this.handleMessage(line)
    }
  }

  private handleMessage(text: string): void {
    let message: JsonRpcResponse
    try {
      message = JSON.parse(text) as JsonRpcResponse
    } catch {
      return
    }
    if (message.id === undefined) return
    const id = Number(message.id)
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timeout)
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `MCP error ${message.error.code ?? 'unknown'}`))
    } else {
      pending.resolve(message.result)
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

function readContentLengthFrame(buffer: string): { body: string; rest: string } | undefined {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd === -1) return undefined
  const header = buffer.slice(0, headerEnd)
  const match = /^Content-Length:\s*(\d+)/im.exec(header)
  if (!match) return undefined
  const length = Number(match[1])
  const bodyStart = headerEnd + 4
  const bodyEnd = bodyStart + length
  if (buffer.length < bodyEnd) return undefined
  return {
    body: buffer.slice(bodyStart, bodyEnd),
    rest: buffer.slice(bodyEnd),
  }
}

function parseServerInfo(result: unknown): McpServerInfo | undefined {
  const serverInfo = (result as { serverInfo?: unknown }).serverInfo
  if (!isRecord(serverInfo)) return undefined
  return {
    name: typeof serverInfo.name === 'string' ? serverInfo.name : undefined,
    version: typeof serverInfo.version === 'string' ? serverInfo.version : undefined,
  }
}

function startupTimeoutMs(config: McpServerConfig): number {
  return Math.max(1, config.startupTimeoutSec ?? 10) * 1000
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
