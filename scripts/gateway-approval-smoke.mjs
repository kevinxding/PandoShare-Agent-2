#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-approval-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
  await durable.appendEvent({ eventType: 'loop_human_gate_requested', workspaceId: 'default', loopId: 'loop_gateway_approval', goalId: 'goal_gateway_approval', payload: { gateId: 'gate_gateway_approval', reason: 'loop needs approval' } })
  await durable.appendEvent({ eventType: 'gui_action_approval_required', workspaceId: 'default', runId: 'run_gateway_gui', payload: { guiActionId: 'gui_gateway_approval', action: 'click', policy: 'ask' } })
  const bridge = new core.GatewayApprovalBridge({
    workspaceId: 'default',
    durable,
    seedApprovals: [{ approvalId: 'agent_gateway_approval', kind: 'agent_tool_approval', title: 'Agent tool approval', summary: 'mock agent approval', createdAtMs: Date.now() - 10 }],
  })
  const pending = await bridge.listPendingApprovals()
  assert(pending.some(item => item.approvalId === 'agent_gateway_approval'), 'mock agent approval should be listed')
  assert(bridge.formatApprovalForChannel(pending.find(item => item.approvalId === 'gate_gateway_approval')).includes('loop_human_gate'), 'loop human gate should be formatted')
  assert(bridge.formatApprovalForChannel(pending.find(item => item.approvalId === 'gui_gateway_approval')).includes('gui_action_approval'), 'gui approval should be formatted')
  const approved = await bridge.resolveApproval('agent_gateway_approval', 'approve', 'test')
  assert(approved.ok, 'approve should resolve pending approval')
  const denied = await bridge.resolveApproval('gate_gateway_approval', 'deny', 'test')
  assert(denied.ok, 'deny should resolve pending approval')
  const unknown = await bridge.resolveApproval('missing_approval', 'approve', 'test')
  assert(!unknown.ok && unknown.message.includes('Unknown approval id'), 'unknown approval id should be explicit')
  const events = await durable.readEvents()
  assert(events.filter(event => event.eventType === 'gateway_approval_resolved').length >= 2, 'approve and deny should write gateway_approval_resolved')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway approval smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
