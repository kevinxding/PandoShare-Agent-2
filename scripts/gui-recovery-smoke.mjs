#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gui-recovery-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

let writeCount = 0
let releaseCount = 0
const adapter = {
  async observe() {
    return { observationId: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, createdAtMs: Date.now(), summary: 'recovery adapter observation', source: 'mock', confidence: 1 }
  },
  async act(action) {
    if (action.action === 'release_all') {
      releaseCount += 1
      return { ok: true, method: 'mock', message: 'released inputs' }
    }
    writeCount += 1
    await new Promise(resolve => setTimeout(resolve, 50))
    return { ok: true, method: 'mock', message: `late ${action.action}` }
  },
  async verify() {
    return { ok: true, status: 'passed', message: 'late verification', visualChange: 'changed', confidence: 1 }
  },
}

try {
  const runtime = new core.GuiRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default', adapter, defaultApprovalPolicy: 'trusted' })
  const stuck = await runtime.act({ action: 'click', x: 1, y: 2, timeoutMs: 1, approvalPolicy: 'trusted' }, { source: 'test', runId: 'run_gui_recovery_smoke' })
  assert(stuck.state === 'stuck', `timeout action should be stuck, got ${stuck.state}`)
  assert(releaseCount >= 1, 'stuck action should release GUI inputs')
  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
  const events = await durable.readEvents()
  assert(events.some(event => event.eventType === 'gui_action_stuck'), 'timeout should write gui_action_stuck')
  assert(events.some(event => event.eventType === 'gui_input_released'), 'stuck path should write gui_input_released')
  const checkpoints = await durable.readCheckpoints({})
  assert(checkpoints.some(checkpoint => checkpoint.status === 'unsafe_to_replay' && checkpoint.pendingExternalEffects.some(effect => effect.effectType === 'gui_write')), 'stuck gui_write checkpoint should be unsafe and require human')
  const durableRecovery = await durable.decideRecovery({ runId: 'run_gui_recovery_smoke' })
  assert(durableRecovery.decision === 'requires_human', `Durable RecoveryPlanner should require human for unsafe GUI effect, got ${durableRecovery.decision}`)
  const recovery = await runtime.recoverGuiAction(stuck.identity.guiActionId)
  assert(recovery.decision === 'requires_human', `stuck recovery should require human, got ${recovery.decision}`)

  const completedRuntime = new core.GuiRuntime({ workspaceRoot: resolve(smokeRoot, 'completed'), workspaceId: 'default', defaultApprovalPolicy: 'trusted' })
  const completed = await completedRuntime.act({ action: 'screenshot', approvalPolicy: 'trusted' }, { source: 'test' })
  const completedRecovery = await completedRuntime.recoverGuiAction(completed.identity.guiActionId)
  assert(completedRecovery.decision === 'already_completed', `completed recovery should be already_completed, got ${completedRecovery.decision}`)
  assert(writeCount === 1, `recovery must not auto-replay write action, got writeCount=${writeCount}`)
  console.log('gui recovery smoke passed')
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
