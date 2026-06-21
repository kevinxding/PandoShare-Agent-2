#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const outputDir = resolve(root, '.tmp-model-probe-offline-smoke')
assertInside(root, outputDir)
await rm(outputDir, { recursive: true, force: true })
delete process.env.PANDO_MODEL_PROBE_ONLINE

try {
  const { runModelProbes } = await import('../dist/src/core/model-probe/index.js').catch(() => {
    throw new Error('Compiled model-probe module is missing. Run `npm run build` first.')
  })
  const run = await runModelProbes({ config: config(), workspaceRoot: root, workspaceId: 'model-probe-offline-smoke', outputDir })
  assert(run.mode === 'offline', `default run should be offline, got ${run.mode}`)
  assert(run.onlineEnabled === false, 'default run should not enable online probes')
  assert(result(run, 'online_minimal').status === 'skipped', 'online_minimal should be skipped by default')
  assert(result(run, 'latency_mock').status === 'passed', 'latency_mock should pass offline')
  assert(result(run, 'catalog_shape').status === 'passed', 'catalog_shape should pass offline')
  assert(result(run, 'capability_static').status === 'passed', 'capability_static should pass offline')
  assert(!run.results.some(item => item.status === 'failed'), 'offline probes should not fail for baseline config')
  console.log('model probe offline smoke passed')
} finally {
  assertInside(root, outputDir)
  await rm(outputDir, { recursive: true, force: true })
}

function result(run, type) {
  const found = run.results.find(item => item.type === type)
  assert(found, `missing probe result ${type}`)
  return found
}

function config() {
  return {
    model: { provider: 'probe-local', name: 'probe-local-model' },
    providers: {
      'probe-local': provider('Probe Local', 'probe-local-model', { type: 'none' }),
      'probe-missing': provider('Probe Missing Auth', 'probe-missing-model', { type: 'api-key', envKeys: ['MODEL_PROBE_MISSING_KEY'] }),
    },
  }
}

function provider(name, model, auth) {
  return {
    name,
    baseURL: 'https://example.invalid/v1',
    model,
    protocol: 'openai-chat-completions',
    auth,
    capabilities: { tools: true, reasoning: true, contextWindowTokens: 64000 },
  }
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
