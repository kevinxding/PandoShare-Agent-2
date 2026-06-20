#!/usr/bin/env node
import { resolve } from 'node:path'

const { createGuiBackendFromMcpConnections, diagnoseGuiBackend, formatGuiDoctorReport } = await import('../dist/src/services/gui/index.js')
const { closeMcpConnections, connectConfiguredMcpServers } = await import('../dist/src/services/mcp/index.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { GuiTool } = await import('../dist/src/tools/GuiTool/index.js')

const serverPath = resolve(process.cwd(), 'scripts/fake-mcp-server.mjs')
const connections = await connectConfiguredMcpServers({
  mcpServers: {
    fake_gui: {
      command: process.execPath,
      args: [serverPath],
      startupTimeoutSec: 5,
    },
  },
})

try {
  const backend = createGuiBackendFromMcpConnections(connections)
  assert(backend, 'fake MCP server should create a GUI backend')
  const report = diagnoseGuiBackend(backend)
  assert(report.ok, `GUI doctor should pass: ${JSON.stringify(report)}`)
  assert(report.sources.some(source => source.serverName === 'fake_gui' && source.humanGuiToolCount === 20), 'GUI doctor should expose human GUI tool count')
  assert(report.dingxu?.ok === true, `GUI doctor should expose complete Dingxu-compatible health: ${JSON.stringify(report.dingxu)}`)
  assert(report.dingxu?.humanGuiToolCount === 20, 'GUI doctor should count all Dingxu-compatible human GUI tools')
  assert(report.dingxu?.missingTools.length === 0, 'GUI doctor should not report missing Dingxu-compatible tools')
  assert(report.capabilities.includes('advanced_grid_reflex_multi_stroke'), 'GUI doctor should expose advanced Dingxu-like capability')
  assert(formatGuiDoctorReport(report).includes('dingxu: complete'), 'GUI doctor text should include Dingxu core status')
  assert(formatGuiDoctorReport(report).includes('human_gui:20'), 'GUI doctor text should include human GUI tool count')
  const registry = createToolRegistry([GuiTool])
  const events = []
  const context = {
    cwd: process.cwd(),
    sessionId: 'gui-tool-smoke',
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

  const uia = await runOne(registry, context, 'uia_success', {
    action: 'click',
    target: 'button',
  })
  assert(uia.ok, `UIA path should pass: ${uia.content}`)
  assert(uia.content.includes('"method": "uia"'), 'UIA success should report method uia')

  const fallback = await runOne(registry, context, 'visual_fallback', {
    action: 'click',
    target: 'force_visual',
    x: 10,
    y: 20,
  })
  assert(fallback.ok, `visual fallback should pass: ${fallback.content}`)
  assert(fallback.content.includes('"method": "human_gui"'), 'fallback should report method human_gui')
  assert(fallback.content.includes('"fallbackUsed": true'), 'fallback should report fallbackUsed')
  const fallbackPayload = JSON.parse(fallback.content)
  assert(fallbackPayload.audit?.tool === 'human_gui_execute_click', 'fallback result should expose Dingxu action tool audit')
  assert(fallbackPayload.audit?.toolDiscipline?.confirmationId === 'confirm_fake', 'fallback result should expose Dingxu confirmation discipline')
  assert(fallbackPayload.audit?.visualReview?.classification === 'changed', 'fallback result should expose Dingxu visual review')
  assert(fallbackPayload.audit?.postActionVerification?.passed === true, 'fallback result should expose Dingxu post-action verification')

  const verification = await runOne(registry, context, 'verify_success', {
    action: 'click',
    x: 10,
    y: 20,
    verify: true,
  })
  assert(verification.ok, `verification success should pass: ${verification.content}`)

  const failed = await runOne(registry, context, 'unsupported_action', {
    action: 'force_visual',
  })
  assert(!failed.ok, 'unsupported action should fail')
  assert(failed.content.includes('unsupported_action'), 'unsupported action failure should include failure class')

  const release = await runOne(registry, context, 'release_all', {
    action: 'release_all',
  })
  assert(release.ok, `release_all should pass: ${release.content}`)
  assert(release.content.includes('"method": "human_gui"'), 'release_all should report method human_gui')

  const draw = await runOne(registry, context, 'draw_path', {
    action: 'draw_path',
    points: [
      { x: 1, y: 2 },
      { x: 10, y: 20 },
    ],
  })
  assert(draw.ok, `draw_path should pass: ${draw.content}`)
  assert(draw.content.includes('"method": "human_gui"'), 'draw_path should report method human_gui')
  assert(releaseToolCount(draw.content) === 2, 'draw_path should release GUI inputs before and after the long action')
  assert(JSON.parse(draw.content).audit?.afterImagePath === '.tmp/fake-human-after.png', 'draw_path should preserve Dingxu after-image audit path')

  const drawPaths = await runOne(registry, context, 'draw_paths', {
    action: 'draw_paths',
    strokes: [
      [
        { x: 1, y: 2 },
        { x: 10, y: 20 },
      ],
      [
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ],
    ],
  })
  assert(drawPaths.ok, `draw_paths should pass: ${drawPaths.content}`)
  assert(drawPaths.content.includes('human_gui_draw_paths'), 'draw_paths should call Dingxu draw_paths')

  const fastClick = await runOne(registry, context, 'fast_click', {
    action: 'fast_click',
    x: 12,
    y: 24,
    confidence: 0.96,
  })
  assert(fastClick.ok, `fast_click should pass: ${fastClick.content}`)
  assert(fastClick.content.includes('"method": "human_gui"'), 'fast_click should report method human_gui')

  const grid = await runOne(registry, context, 'analyze_grid', {
    action: 'analyze_grid',
    region: {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    },
    targetColor: 'brown',
  })
  assert(grid.ok, `analyze_grid should pass: ${grid.content}`)
  assert(grid.content.includes('human grid ok'), 'analyze_grid should call Dingxu grid analyzer')

  const reflex = await runOne(registry, context, 'reflex_click', {
    action: 'reflex_click',
    region: {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    },
    durationMs: 100,
    maxClicks: 1,
  })
  assert(reflex.ok, `reflex_click should pass: ${reflex.content}`)
  assert(reflex.content.includes('human reflex click ok'), 'reflex_click should call Dingxu reflex click')

  const keyState = await runOne(registry, context, 'set_key_state', {
    action: 'set_key_state',
    keys: ['Shift'],
    state: 'up',
  })
  assert(keyState.ok, `set_key_state should pass: ${keyState.content}`)
  assert(keyState.content.includes('human_gui_set_key_state'), 'set_key_state should call Dingxu key state tool')
  assert(releaseToolCount(keyState.content) === 2, 'key release should include release guards')
  assert(JSON.parse(keyState.content).audit?.focusDiscipline?.focused === true, 'key state result should expose Dingxu focus discipline')

  const holdKey = await runOne(registry, context, 'hold_key', {
    action: 'hold_key',
    keys: ['Shift'],
  })
  assert(holdKey.ok, `hold_key should pass: ${holdKey.content}`)
  assert(holdKey.content.includes('human_gui_set_key_state'), 'hold_key should call Dingxu key state tool')
  assert(releaseToolCount(holdKey.content) === 1, 'hold_key should only release before pressing and must not release after')

  const mouseState = await runOne(registry, context, 'mouse_up', {
    action: 'mouse_up',
    button: 'left',
  })
  assert(mouseState.ok, `mouse_up should pass: ${mouseState.content}`)
  assert(mouseState.content.includes('human mouse button state ok'), 'mouse_up should call Dingxu mouse button state tool')

  const compare = await runOne(registry, context, 'compare_observations', {
    action: 'compare_observations',
    beforeObservationId: 'obs_before',
    afterObservationId: 'obs_after',
    verify: 'required',
  })
  assert(compare.ok, `compare_observations should pass: ${compare.content}`)
  assert(compare.content.includes('human compare ok'), 'compare_observations should call Dingxu comparison tool')

  assert(events.some(event => event.type === 'gui_action_started'), 'events should include gui_action_started')
  assert(events.some(event => event.type === 'gui_action_completed'), 'events should include gui_action_completed')
  assert(events.some(event => event.type === 'gui_action_failed'), 'events should include gui_action_failed')
  assert(events.some(event => event.type === 'gui_action_verified'), 'events should include gui_action_verified')

  console.log('gui tool smoke passed')
} finally {
  closeMcpConnections(connections)
}

async function runOne(registry, context, id, input) {
  const results = []
  for await (const update of runTools([{ id, name: 'gui_action', input }], registry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `expected one result for ${id}`)
  return results[0]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function releaseToolCount(content) {
  return content.match(/human_gui_release_all/g)?.length ?? 0
}
