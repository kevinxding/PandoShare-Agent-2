import { createTextResult, type ToolDefinition } from '../../Tool.js'
import type { ProjectConfig } from '../config/index.js'
import { eventBase, type AgentEventHandler } from '../events/index.js'
import { StdioMcpClient } from './client.js'
import type { McpConnectionReport, McpServerConnection, McpToolInfo } from './types.js'

export * from './client.js'
export * from './types.js'

export type ConnectMcpServersOptions = {
  sessionId?: string
  emitEvent?: AgentEventHandler
}

export async function connectConfiguredMcpServers(
  config: ProjectConfig,
  options: ConnectMcpServersOptions = {},
): Promise<McpServerConnection[]> {
  const servers = config.mcpServers ?? {}
  const connections: McpServerConnection[] = []
  for (const [serverName, serverConfig] of Object.entries(servers)) {
    await options.emitEvent?.({
      ...eventBase({ sessionId: options.sessionId ?? 'mcp' }, 'mcp_server_started'),
      type: 'mcp_server_started',
      serverName,
      command: serverConfig.command,
    })
    const client = new StdioMcpClient(serverName, serverConfig)
    try {
      const serverInfo = await client.connect()
      const tools = await client.listTools()
      const resources = await safeListResources(client)
      connections.push({
        serverName,
        status: 'connected',
        serverInfo,
        tools,
        resources,
        client,
      })
      await options.emitEvent?.({
        ...eventBase({ sessionId: options.sessionId ?? 'mcp' }, 'mcp_server_connected'),
        type: 'mcp_server_connected',
        serverName,
        toolCount: tools.length,
        serverInfo,
      })
    } catch (error) {
      const message = errorMessage(error)
      client.close()
      connections.push({
        serverName,
        status: 'failed',
        tools: [],
        error: message,
      })
      await options.emitEvent?.({
        ...eventBase({ sessionId: options.sessionId ?? 'mcp' }, 'mcp_server_failed'),
        type: 'mcp_server_failed',
        serverName,
        message,
      })
    }
  }
  return connections
}

export function closeMcpConnections(connections: readonly McpServerConnection[]): void {
  for (const connection of connections) {
    connection.client?.close()
  }
}

export function mcpConnectionsToToolDefinitions(connections: readonly McpServerConnection[]): ToolDefinition[] {
  return connections.flatMap(connection => {
    const client = connection.client
    if (connection.status !== 'connected' || !client) return []
    return connection.tools.map(tool => createMcpToolDefinition(connection.serverName, tool, client))
  })
}

export function summarizeMcpConnections(connections: readonly McpServerConnection[]): McpConnectionReport[] {
  return connections.map(connection => ({
    serverName: connection.serverName,
    status: connection.status,
    serverInfo: connection.serverInfo,
    toolCount: connection.tools.length,
    tools: connection.tools,
    resourceCount: connection.resources?.length ?? 0,
    resources: connection.resources ?? [],
    error: connection.error,
  }))
}

export function formatMcpReport(connections: readonly McpServerConnection[]): string {
  if (!connections.length) return 'No MCP servers configured.\n'
  const lines: string[] = []
  for (const connection of connections) {
    lines.push(`${connection.status === 'connected' ? 'PASS' : 'FAIL'} ${connection.serverName}`)
    if (connection.serverInfo?.name || connection.serverInfo?.version) {
      lines.push(`  server: ${connection.serverInfo.name ?? 'unknown'} ${connection.serverInfo.version ?? ''}`.trimEnd())
    }
    if (connection.error) lines.push(`  error: ${connection.error}`)
    if (connection.tools.length) lines.push(`  tools: ${connection.tools.map(tool => tool.name).join(', ')}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function safeListResources(client: StdioMcpClient): Promise<NonNullable<McpServerConnection['resources']>> {
  try {
    return await client.listResources()
  } catch {
    return []
  }
}

function createMcpToolDefinition(
  serverName: string,
  tool: McpToolInfo,
  client: NonNullable<McpServerConnection['client']>,
): ToolDefinition {
  return {
    name: `mcp__${sanitizeToolName(serverName)}__${sanitizeToolName(tool.name)}`,
    description: tool.description ?? `MCP tool ${tool.name} from ${serverName}.`,
    safety: 'external_write',
    inputSchema: tool.inputSchema,
    async execute(toolUse) {
      const result = await client.callTool(tool.name, toolUse.input)
      return createTextResult(toolUse.id, formatMcpToolResult(result))
    },
  }
}

function formatMcpToolResult(result: unknown): string {
  const content = (result as { content?: unknown }).content
  if (Array.isArray(content)) {
    const text = content
      .map(item => {
        if (!item || typeof item !== 'object') return undefined
        const record = item as Record<string, unknown>
        if (record.type === 'text' && typeof record.text === 'string') return record.text
        return JSON.stringify(record)
      })
      .filter((item): item is string => Boolean(item))
      .join('\n')
    if (text) return text
  }
  if (typeof result === 'string') return result
  return JSON.stringify(result, null, 2)
}

function sanitizeToolName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_')
  return sanitized || 'tool'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
