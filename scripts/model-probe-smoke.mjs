#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const outputDir = resolve(root, '.tmp-model-probe-smoke')
assertInside(root, outputDir)
await rm(outputDir, { recursive: true, force: true })

const secret = 'sk-model-probe-smoke-secretsecret'
process.env.MODEL_PROBE_SMOKE_API_KEY = secret
delete process.env.PANDO_MODEL_PROBE_ONLINE

try {
  const { ProbeReport, runModelProbes } = await import('../dist/src/core/model-probe/index.js').catch(() => {
    throw new Error('Compiled model-probe module is missing. Run `npm run build` first.')
  })
  const run = await runModelProbes({ config: config(), workspaceRoot: root, workspaceId: 'model-probe-smoke', outputDir })
  assert(run.providers.length > 0, 'offline probe should list providers')
  assert(run.models.length > 0, 'offline probe should list models')
  assert(run.profiles.length > 0, 'offline probe should list profiles')
  assert(run.fallbackChain.length > 1, 'fallback simulation should produce a chain with alternates')

  const auth = result(run, 'auth_presence')
  assert(auth.status === 'missing_auth', `missing auth should be reported only as missing_auth, got ${auth.status}`)
  for (const provider of auth.data.providers) {
    if (provider.missingAuth) assert(provider.authState === 'missing_auth', `missing provider ${provider.providerId} should use missing_auth state`)
  }
  assert(!run.results.some(item => item.message.includes(secret)), 'probe result messages must not include env values')

  const online = result(run, 'online_minimal')
  assert(online.status === 'skipped', `online_minimal should be skipped by default, got ${online.status}`)

  const taintedRun = {
    ...run,
    results: [
      ...run.results,
      {
        ...run.results[0],
        id: 'probe_secret_redaction_guard',
        message: `token=${secret}`,
        data: { apiKey: secret, nested: { authorization: `Bearer ${secret}` } },
      },
    ],
  }
  await ProbeReport.write(taintedRun, outputDir)
  const json = await readFile(run.reportFiles.jsonPath, 'utf8')
  const markdown = await readFile(run.reportFiles.markdownPath, 'utf8')
  assert(!json.includes(secret), 'JSON report should redact env-like secret values')
  assert(!markdown.includes(secret), 'Markdown report should redact env-like secret values')
  assert(json.includes('<redacted>') && markdown.includes('<redacted>'), 'reports should include redaction marker for tainted values')

  console.log('model probe smoke passed')
} finally {
  assertInside(root, outputDir)
  await rm(outputDir, { recursive: true, force: true })
  delete process.env.MODEL_PROBE_SMOKE_API_KEY
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
      'probe-local': provider('Probe Local', 'probe-local-model', { type: 'none' }, { tools: true, reasoning: true, streaming: true, contextWindowTokens: 128000 }),
      'probe-unknown': provider('Probe Unknown Cost', 'probe-unknown-model', { type: 'none' }, { tools: true, reasoning: true, contextWindowTokens: 64000 }),
      'probe-missing': provider('Probe Missing Auth', 'probe-missing-model', { type: 'api-key', envKeys: ['MODEL_PROBE_MISSING_KEY'] }, { tools: true, reasoning: true, contextWindowTokens: 64000 }),
      'probe-secret': provider('Probe Secret Env', 'probe-secret-model', { type: 'api-key', envKeys: ['MODEL_PROBE_SMOKE_API_KEY'] }, { tools: true, reasoning: true, contextWindowTokens: 64000 }),
    },
  }
}

function provider(name, model, auth, capabilities) {
  return {
    name,
    baseURL: 'https://example.invalid/v1',
    model,
    protocol: 'openai-chat-completions',
    auth,
    capabilities,
  }
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
