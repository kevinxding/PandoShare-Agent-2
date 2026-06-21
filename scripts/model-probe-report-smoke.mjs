#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const outputDir = resolve(root, '.tmp-model-probe-report-smoke')
assertInside(root, outputDir)
await rm(outputDir, { recursive: true, force: true })
delete process.env.PANDO_MODEL_PROBE_ONLINE

try {
  const { runModelProbes } = await import('../dist/src/core/model-probe/index.js').catch(() => {
    throw new Error('Compiled model-probe module is missing. Run `npm run build` first.')
  })
  const run = await runModelProbes({ config: config(), workspaceRoot: root, workspaceId: 'model-probe-report-smoke', outputDir })
  assert(run.reportFiles?.jsonPath, 'probe run should expose json report path')
  assert(run.reportFiles?.markdownPath, 'probe run should expose markdown report path')
  const json = await readFile(run.reportFiles.jsonPath, 'utf8')
  const markdown = await readFile(run.reportFiles.markdownPath, 'utf8')
  assert(json.includes('"summary"'), 'json report should contain summary')
  assert(markdown.includes('Model Production Probes Report'), 'markdown report should contain report heading')
  assert(markdown.includes('Fallback Chain'), 'markdown report should contain fallback chain')
  assert(!json.includes('sk-report-smoke-secretsecret'), 'json report must not contain secret values')
  assert(!markdown.includes('sk-report-smoke-secretsecret'), 'markdown report must not contain secret values')
  console.log('model probe report smoke passed')
} finally {
  assertInside(root, outputDir)
  await rm(outputDir, { recursive: true, force: true })
}

function config() {
  return {
    model: { provider: 'probe-local', name: 'probe-local-model' },
    providers: {
      'probe-local': provider('Probe Local', 'probe-local-model', { type: 'none' }),
      'probe-missing': provider('Probe Missing Auth', 'probe-missing-model', { type: 'api-key', envKeys: ['MODEL_PROBE_REPORT_MISSING_KEY'] }),
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
