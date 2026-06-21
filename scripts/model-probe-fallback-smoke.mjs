#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const outputDir = resolve(root, '.tmp-model-probe-fallback-smoke')
assertInside(root, outputDir)
await rm(outputDir, { recursive: true, force: true })
delete process.env.PANDO_MODEL_PROBE_ONLINE

try {
  const { runModelProbes } = await import('../dist/src/core/model-probe/index.js').catch(() => {
    throw new Error('Compiled model-probe module is missing. Run `npm run build` first.')
  })
  const run = await runModelProbes({ config: config(), workspaceRoot: root, workspaceId: 'model-probe-fallback-smoke', outputDir })
  const fallback = result(run, 'fallback_simulation')
  assert(fallback.status === 'passed', `fallback simulation should pass, got ${fallback.status}`)
  assert(run.fallbackChain.length >= 2, 'fallback chain should include selected and fallback candidates')
  assert(run.fallbackChain[0].role === 'selected', 'first fallback chain item should be selected')
  assert(run.fallbackChain.some(step => step.role === 'fallback'), 'chain should include fallback role')
  const budget = result(run, 'budget_estimate')
  assert(budget.status === 'passed', 'budget estimate should pass')
  assert(budget.data.unknownCostCount >= 0, 'budget estimate should explicitly track unknown costs')
  console.log('model probe fallback smoke passed')
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
    model: { provider: 'probe-a', name: 'probe-a-model' },
    providers: {
      'probe-a': provider('Probe A', 'probe-a-model'),
      'probe-b': provider('Probe B', 'probe-b-model'),
      'probe-c': provider('Probe C', 'probe-c-model'),
    },
  }
}

function provider(name, model) {
  return {
    name,
    baseURL: 'https://example.invalid/v1',
    model,
    protocol: 'openai-chat-completions',
    auth: { type: 'none' },
    capabilities: { tools: true, reasoning: true, contextWindowTokens: 128000 },
  }
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
