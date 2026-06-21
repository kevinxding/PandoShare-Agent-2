#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const loopEngineering = await import('../dist/src/core/loop-engineering/index.js')
const memory = await import('../dist/src/core/memory/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-productization-smoke', 'loop-skill-candidate')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const store = new memory.MemoryStore(resolve(smokeRoot, 'memory.jsonl'))
  const writer = new loopEngineering.SkillCandidateWriter(store)
  const candidate = {
    skillId: 'loop-v3-smoke-skill',
    trigger: 'When Loop Engineering sees api_key=sk-1234567890abcdef in verifier notes.',
    procedure: ['Capture the trigger.', 'Run bounded verification.', 'Record pitfalls before reuse.'],
    verification: ['Memory record is scope=skill.', 'Secret-like material is redacted.'],
    pitfalls: ['Do not overwrite an existing skill candidate.', 'Do not execute connector plans.'],
    refs: ['docs/productization/loop-engineering-v3.md'],
    source: 'loop-skill-candidate-smoke',
    loopId: 'loop_skill_smoke',
    goalId: 'goal_skill_smoke',
  }
  const first = await writer.writeCandidate(candidate)
  assert(first.written === true, 'first skill candidate write should succeed')
  assert(first.redacted === true, 'skill candidate should be redacted by MemoryStore')
  const duplicate = await writer.writeCandidate(candidate)
  assert(duplicate.written === false && duplicate.reason === 'skill_candidate_exists', 'duplicate skill candidate should not overwrite')
  const records = await store.read({ scope: 'skill' })
  assert(records.length === 1, 'duplicate candidate should leave one memory record')
  assert(records[0].content.includes('<redacted>'), 'stored skill candidate should redact secret-like values')
  assert(records[0].tags.includes('skill:loop-v3-smoke-skill'), 'stored skill candidate should include stable skill tag')

  const registry = new loopEngineering.SubAgentRegistry()
  const assignment = registry.assign({
    subagents: [
      { agentId: 'builder_a', role: 'builder', family: 'builder-family' },
      { agentId: 'planner_a', role: 'planner', family: 'planner-family' },
      { agentId: 'verifier_a', role: 'verifier', family: 'verifier-family' },
      { agentId: 'gui_a', role: 'gui-operator', family: 'gui-family' },
      { agentId: 'gateway_a', role: 'gateway-operator', family: 'gateway-family' },
      { agentId: 'reviewer_a', role: 'reviewer', family: 'reviewer-family' },
    ],
  })
  assert(assignment.ok === true, 'independent subagent assignment should pass')
  assert(assignment.assignments.find(agent => agent.role === 'builder')?.permission.name === 'loop_worker', 'builder should bind loop_worker permissions')
  assert(assignment.assignments.find(agent => agent.role === 'verifier')?.permission.name === 'verifier', 'verifier should bind verifier permissions')
  assert(assignment.assignments.find(agent => agent.role === 'gui-operator')?.permission.name === 'gui_write_approval', 'gui operator should bind gui approval permissions')
  assert(assignment.assignments.find(agent => agent.role === 'gateway-operator')?.permission.name === 'gateway_operator', 'gateway operator should bind gateway permissions')

  const conflict = registry.assign({
    subagents: [
      { agentId: 'builder_same', role: 'builder', family: 'same-family' },
      { agentId: 'verifier_same', role: 'verifier', family: 'same-family' },
    ],
  })
  assert(conflict.ok === false, 'same-family verifier should be rejected')
  assert(conflict.failureReasons.some(reason => reason.includes('cannot share builder family')), 'same-family verifier failure should be clear')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('loop skill candidate smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error('Refusing to use path outside workspace: ' + targetPath)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}