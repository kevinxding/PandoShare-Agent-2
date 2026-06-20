#!/usr/bin/env node
import { resolve } from 'node:path'

const {
  closeMcpConnections,
  connectConfiguredMcpServers,
  mcpConnectionsToToolDefinitions,
  summarizeMcpConnections,
} = await import('../dist/src/services/mcp/index.js')

const serverPath = resolve(process.cwd(), 'scripts/fake-mcp-server.mjs')

const connections = await connectConfiguredMcpServers({
  mcpServers: {
    fake: {
      command: process.execPath,
      args: [serverPath],
      startupTimeoutSec: 5,
    },
  },
})

try {
  assert(connections.length === 1, `expected 1 connection, got ${connections.length}`)
  const connection = connections[0]
  assert(connection.status === 'connected', `expected connected, got ${connection.status}`)
  assert(connection.serverInfo?.name === 'FakePandoMcp', 'initialize should return serverInfo')
  assert(connection.tools.length >= 4, `expected fake tools, got ${connection.tools.length}`)

  const callResult = await connection.client.callTool('echo', { text: 'mcp-call-ok' })
  assert(JSON.stringify(callResult).includes('mcp-call-ok'), 'tools/call should return echo text')

  const tools = mcpConnectionsToToolDefinitions(connections)
  const echoTool = tools.find(tool => tool.name === 'mcp__fake__echo')
  assert(echoTool, 'MCP echo tool should be converted to ToolDefinition')
  const toolResult = await echoTool.execute(
    {
      id: 'call_mcp_echo',
      name: echoTool.name,
      input: {
        text: 'adapted-ok',
      },
    },
    {
      cwd: process.cwd(),
      sessionId: 'mcp-client-smoke',
      permissionMode: 'default',
    },
  )
  assert(toolResult.content.includes('adapted-ok'), 'adapted MCP tool should return text result')
} finally {
  closeMcpConnections(connections)
}

const failedConnections = await connectConfiguredMcpServers({
  mcpServers: {
    broken: {
      command: process.execPath,
      args: [serverPath, '--fail'],
      startupTimeoutSec: 1,
    },
  },
})
try {
  const report = summarizeMcpConnections(failedConnections)
  assert(report[0]?.status === 'failed', 'failed MCP server should be reported as failed')
  assert(Boolean(report[0]?.error), 'failed MCP server should include error')
} finally {
  closeMcpConnections(failedConnections)
}

const jsonLineConnections = await connectConfiguredMcpServers({
  mcpServers: {
    json_lines_fake: {
      command: process.execPath,
      args: [serverPath, '--json-lines'],
      startupTimeoutSec: 5,
      messageFormat: 'json-lines',
    },
  },
})
try {
  const connection = jsonLineConnections[0]
  assert(connection?.status === 'connected', 'json-lines MCP server should connect')
  assert(connection.serverInfo?.name === 'FakePandoMcp', 'json-lines initialize should return serverInfo')
  const callResult = await connection.client.callTool('echo', { text: 'json-lines-ok' })
  assert(JSON.stringify(callResult).includes('json-lines-ok'), 'json-lines tools/call should return echo text')
} finally {
  closeMcpConnections(jsonLineConnections)
}

console.log('mcp client smoke passed')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
