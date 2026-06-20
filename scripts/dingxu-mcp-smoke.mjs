#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const { closeMcpConnections, connectConfiguredMcpServers } = await import('../dist/src/services/mcp/index.js')
const { createGuiBackendFromMcpConnections, diagnoseGuiBackend, formatGuiDoctorReport } = await import('../dist/src/services/gui/index.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { GuiTool } = await import('../dist/src/tools/GuiTool/index.js')

const configPath = resolve(process.cwd(), 'pandoshare.config.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const serverConfig = config.mcpServers?.dingxu_gui
assert(serverConfig, 'pandoshare.config.json must define mcpServers.dingxu_gui')

const connections = await connectConfiguredMcpServers({
  mcpServers: {
    dingxu_gui: serverConfig,
  },
})

try {
  const connection = connections.find(item => item.serverName === 'dingxu_gui')
  assert(connection, 'dingxu_gui connection should exist')
  assert(connection.status === 'connected', `dingxu_gui should connect: ${connection.error ?? 'unknown error'}`)
  assert(connection.serverInfo?.name === 'Dingxu Human GUI', `unexpected server name: ${connection.serverInfo?.name}`)
  assert(connection.serverInfo?.version === '0.1.0', `unexpected server version: ${connection.serverInfo?.version}`)
  assert(connection.tools.length === 20, `expected 20 Dingxu tools, got ${connection.tools.length}`)
  const toolNames = new Set(connection.tools.map(tool => tool.name))
  for (const name of [
    'human_gui_observe',
    'human_gui_run_sequence',
    'human_gui_execute_click',
    'human_gui_type_text',
    'human_gui_draw_path',
    'human_gui_release_all',
  ]) {
    assert(toolNames.has(name), `missing Dingxu tool: ${name}`)
  }
  const backend = createGuiBackendFromMcpConnections(connections)
  assert(backend, 'dingxu_gui connection should create a GUI backend')
  const guiReport = diagnoseGuiBackend(backend)
  assert(guiReport.ok === true, `Dingxu GUI backend should diagnose ok: ${JSON.stringify(guiReport)}`)
  assert(guiReport.dingxu.ok === true, `Dingxu GUI health should be complete: ${JSON.stringify(guiReport.dingxu)}`)
  assert(guiReport.dingxu.serverName === 'Dingxu Human GUI', `Dingxu health should expose server name: ${guiReport.dingxu.serverName}`)
  assert(guiReport.dingxu.humanGuiToolCount === 20, `Dingxu health should count 20 tools: ${guiReport.dingxu.humanGuiToolCount}`)
  assert(formatGuiDoctorReport(guiReport).includes('dingxu: complete'), 'Dingxu doctor text should show complete status')

  const registry = createToolRegistry([GuiTool])
  const events = []
  const context = {
    cwd: process.cwd(),
    sessionId: 'dingxu-gui-action-smoke',
    permissionMode: 'default',
    permissions: {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    },
    metadata: {
      guiBackend: backend,
    },
    emitEvent(event) {
      events.push(event)
    },
  }

  const observe = await runGui(registry, context, 'dingxu_observe', {
    action: 'observe',
  })
  assert(observe.ok, `observe should pass through Pando gui_action: ${observe.content}`)
  assert(observe.content.includes('"method": "human_gui"'), 'observe should report human_gui method')

  const wait = await runGui(registry, context, 'dingxu_wait', {
    action: 'wait',
    timeoutMs: 1,
  })
  assert(wait.ok, `wait should pass through Pando gui_action: ${wait.content}`)
  assert(wait.content.includes('"method": "human_gui"'), 'wait should report human_gui method')

  const release = await runGui(registry, context, 'dingxu_release_all', {
    action: 'release_all',
    timeoutMs: 1,
  })
  assert(release.ok, `release_all should pass through Pando gui_action: ${release.content}`)
  assert(release.content.includes('"method": "human_gui"'), 'release_all should report human_gui method')

  const missingClick = await runGui(registry, context, 'dingxu_click_missing_coordinates', {
    action: 'click',
  })
  assert(!missingClick.ok, 'click without coordinates should fail before moving the pointer')
  assert(missingClick.content.includes('missing_coordinates'), 'click failure should include missing_coordinates')

  const missingText = await runGui(registry, context, 'dingxu_type_missing_text', {
    action: 'type',
  })
  assert(!missingText.ok, 'type without text should fail before typing')
  assert(missingText.content.includes('missing_text'), 'type failure should include missing_text')

  const missingKeys = await runGui(registry, context, 'dingxu_keys_missing_keys', {
    action: 'hotkey',
  })
  assert(!missingKeys.ok, 'hotkey without keys should fail before pressing keys')
  assert(missingKeys.content.includes('missing_keys'), 'hotkey failure should include missing_keys')

  assert(events.some(event => event.type === 'gui_action_started'), 'events should include gui_action_started')
  assert(events.some(event => event.type === 'gui_action_completed'), 'events should include gui_action_completed')
  assert(events.some(event => event.type === 'gui_action_failed'), 'events should include gui_action_failed')

  console.log('dingxu MCP smoke passed')
} finally {
  closeMcpConnections(connections)
}

async function runGui(registry, context, id, input) {
  const results = []
  for await (const update of runTools([{ id, name: 'gui_action', input }], registry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `expected one GUI result for ${id}`)
  return results[0]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
