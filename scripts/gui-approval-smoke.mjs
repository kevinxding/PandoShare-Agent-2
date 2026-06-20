#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gui-approval-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

let actCount = 0
const adapter = {
  async observe() {
    return { observationId: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, createdAtMs: Date.now(), summary: 'approval adapter observation', source: 'mock', confidence: 1 }
  },
  async act(action) {
    actCount += action.action === 'release_all' ? 0 : 1
    return { ok: true, method: 'mock', message: `approved ${action.action}` }
  },
  async verify() {
    return { ok: true, status: 'passed', message: 'approval adapter verified', visualChange: 'changed', confidence: 1 }
  },
}

try {
  const runtime = new core.GuiRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default', adapter, defaultApprovalPolicy: 'ask' })
  const pending = await runtime.requestAction({ action: 'click', x: 10, y: 20 }, { source: 'test' })
  assert(pending.state === 'waiting_approval', `click should wait approval, got ${pending.state}`)
  assert(actCount === 0, 'approvalPolicy=ask must not execute adapter before approval')
  const approved = await runtime.approveGuiAction(pending.identity.guiActionId, 'approval smoke')
  assert(approved.state === 'approved', `approve should mark approved, got ${approved.state}`)
  const executed = await runtime.executeApprovedAction(pending.identity.guiActionId)
  assert(executed.state === 'completed', `approved action should complete, got ${executed.state}`)
  assert(actCount === 1, `approved action should execute exactly once, got ${actCount}`)

  const reject = await runtime.requestAction({ action: 'type', text: 'blocked' }, { source: 'test' })
  await runtime.rejectGuiAction(reject.identity.guiActionId, 'reject smoke')
  const rejected = await runtime.readAction(reject.identity.guiActionId)
  assert(rejected?.state === 'rejected', `reject should persist rejected state, got ${rejected?.state}`)
  assert(actCount === 1, 'rejected action must not execute adapter')

  const unknown = await runtime.requestAction({ action: 'mystery_action' }, { source: 'test' })
  assert(unknown.state === 'waiting_approval', `unknown action should require approval, got ${unknown.state}`)
  assert(unknown.sideEffect.effectType === 'gui_dangerous_write', `unknown action should default dangerous, got ${unknown.sideEffect.effectType}`)

  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
  const events = await durable.readEvents()
  for (const type of ['gui_action_approval_required', 'gui_action_approved', 'gui_action_rejected']) {
    assert(events.some(event => event.eventType === type), `missing ${type}`)
  }
  console.log('gui approval smoke passed')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
