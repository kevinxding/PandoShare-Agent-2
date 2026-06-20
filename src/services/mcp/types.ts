import type { McpServerConfig as ProjectMcpServerConfig } from '../config/index.js'

export type McpServerConfig = ProjectMcpServerConfig

export type McpToolInfo = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpResourceInfo = {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export type McpServerInfo = {
  name?: string
  version?: string
}

export type McpConnectionStatus = 'connected' | 'failed'

export type McpServerConnection = {
  serverName: string
  status: McpConnectionStatus
  serverInfo?: McpServerInfo
  tools: McpToolInfo[]
  resources?: McpResourceInfo[]
  error?: string
  client?: {
    callTool(name: string, input: Record<string, unknown>): Promise<unknown>
    listResources?(): Promise<McpResourceInfo[]>
    readResource?(uri: string): Promise<unknown>
    close(): void
  }
}

export type McpConnectionReport = {
  serverName: string
  status: McpConnectionStatus
  serverInfo?: McpServerInfo
  toolCount: number
  tools: McpToolInfo[]
  resourceCount?: number
  resources?: McpResourceInfo[]
  error?: string
}
