#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { VerifierGraph } = await import('../dist/src/core/loop-engineering/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-productization-smoke', 'loop-verifier-graph')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await writeFile(resolve(smokeRoot, 'answer.txt'), 'ready\n', 'utf8')
  const graph = new VerifierGraph()
  let commandCalls = 0
  const result = await graph.run({
    graphId: 'graph_smoke_pass',
    nodes: [
      { nodeId: 'file_ok', type: 'file', path: 'answer.txt', contains: 'ready', verifierIdentity: { verifierId: 'verifier_file', family: 'verifier-family' } },
      { nodeId: 'command_ok', type: 'command', command: 'node -e "process.exit(0)"', dependsOn: ['file_ok'], verifierIdentity: { verifierId: 'verifier_command', family: 'verifier-family' } },
      { nodeId: 'replay_ok', type: 'replay', replayId: 'replay_1', expectedStatus: 'passed', dependsOn: ['command_ok'] },
      { nodeId: 'model_ok', type: 'model_mock', mockOutput: 'the model says verified', expectedContains: 'verified', dependsOn: ['replay_ok'] },
      { nodeId: 'custom_ok', type: 'custom', name: 'custom_gate', dependsOn: ['model_ok'] },
    ],
  }, {
    workspaceRoot: smokeRoot,
    builderFamilies: ['builder-family'],
    commandRunner: async () => {
      commandCalls += 1
      return { exitCode: 0, stdout: 'ok' }
    },
    replayResults: { replay_1: { status: 'passed', summary: 'replayed' } },
    customHandlers: { custom_gate: () => ({ ok: true, message: 'custom gate passed' }) },
  })
  assert(result.ok === true, 'full verifier graph should pass')
  assert(result.nodeResults.length === 5, 'all verifier nodes should run')
  assert(commandCalls === 1, 'command runner should be called once')

  const dependencyFailure = await graph.run({
    graphId: 'graph_smoke_dependency_failure',
    nodes: [
      { nodeId: 'file_missing', type: 'file', path: 'missing.txt', exists: true },
      { nodeId: 'dependent', type: 'model_mock', mockOutput: 'ok', expectedContains: 'ok', dependsOn: ['file_missing'] },
    ],
  }, { workspaceRoot: smokeRoot })
  assert(dependencyFailure.ok === false, 'dependency failure graph should fail')
  assert(dependencyFailure.failureReasons.some(reason => reason.includes('file_missing')), 'failure reasons should name failed file node')
  assert(dependencyFailure.nodeResults.find(result => result.nodeId === 'dependent')?.status === 'skipped', 'dependent node should be skipped')
  assert(dependencyFailure.nodeResults.find(result => result.nodeId === 'dependent')?.reason === 'dependency_failed', 'dependent node should explain dependency failure')

  const identityFailure = await graph.run({
    graphId: 'graph_smoke_identity_failure',
    nodes: [
      { nodeId: 'identity_bad', type: 'model_mock', mockOutput: 'ok', expectedContains: 'ok', verifierIdentity: { verifierId: 'verifier_same', family: 'builder-family' } },
    ],
  }, { builderFamilies: ['builder-family'] })
  assert(identityFailure.ok === false, 'same-family verifier should fail by default')
  assert(identityFailure.failureReasons.some(reason => reason.includes('verifier_identity_not_independent')), 'identity failure should be explicit')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('loop verifier graph smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error('Refusing to use path outside workspace: ' + targetPath)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}