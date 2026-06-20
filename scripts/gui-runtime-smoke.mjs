#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gui-runtime-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const runtime = new core.GuiRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default', defaultApprovalPolicy: 'ask' })
  const observation = await runtime.observe({ source: 'test' })
  assert(observation.source === 'mock', `expected mock observation source, got ${observation.source}`)
  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
  let events = await durable.readEvents()
  assert(events.some(event => event.eventType === 'gui_observation_started'), 'observe should write gui_observation_started')
  assert(events.some(event => event.eventType === 'gui_observation_completed'), 'observe should write gui_observation_completed')

  const readOnly = await runtime.requestAction({ action: 'screenshot' }, { source: 'test' })
  assert(readOnly.approval?.status !== 'waiting', 'read_only action should not require approval')
  assert(readOnly.sideEffect.effectType === 'gui_read', `expected gui_read side effect, got ${readOnly.sideEffect.effectType}`)

  const record = await runtime.act({ action: 'click', x: 1, y: 2, verify: true, approvalPolicy: 'trusted' }, { source: 'test' })
  assert(record.state === 'completed', `trusted write should complete, got ${record.state}`)
  assert(record.beforeObservation?.observationId, 'action record should include before observation')
  assert(record.afterObservation?.observationId, 'action record should include after observation')
  assert(record.verification?.status === 'passed', `expected passed verification, got ${record.verification?.status}`)
  assert(record.checkpointId, 'action should create checkpoint')
  assert(record.eventIds.length >= 3, 'record should reference durable event ids')
  assert(record.beforeObservation?.source === 'mock' && record.afterObservation?.source === 'mock', 'mock adapter should be source=mock')

  const checkpoints = await durable.readCheckpoints({})
  assert(checkpoints.some(checkpoint => checkpoint.checkpointId === record.checkpointId && checkpoint.pendingExternalEffects.some(effect => effect.effectType === 'gui_write')), 'checkpoint should include gui_write pending external effect')
  events = await durable.readEvents()
  for (const type of ['gui_action_requested', 'gui_action_approved', 'gui_action_started', 'gui_action_verified', 'gui_action_completed']) {
    assert(events.some(event => event.eventType === type), `missing ${type}`)
  }
  const timeline = new core.EventReplay().buildTimeline(events)
  const report = new core.ReplayReport().toMarkdown({ timeline })
  assert(report.includes('## GUI Timeline'), 'ReplayReport should include GUI timeline')
  assert(report.includes(record.identity.guiActionId), 'GUI timeline should include guiActionId')
  console.log('gui runtime smoke passed')
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
