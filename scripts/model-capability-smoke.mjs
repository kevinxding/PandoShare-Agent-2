#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-model-capability-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const router = core.ModelRouter.fromConfig(config(), { workspaceRoot: smokeRoot, workspaceId: 'default' })
const visionDecision = await router.route({ taskType: 'vision', requireCapabilities: { vision: true } })
assert(visionDecision.selectedProviderId === 'vision', `vision task should select vision provider, got ${visionDecision.selectedProviderId}`)
assert(visionDecision.rejectedCandidates.some(candidate => candidate.reasons.some(reason => reason.includes('vision'))), 'non-vision providers should be rejected with capability reason')
const impossible = await router.route({ taskType: 'vision', allowedProviders: ['small'], requireCapabilities: { vision: true } })
assert(impossible.status === 'rejected', 'impossible capability route should reject')
assert(impossible.missingCapabilities?.some(reason => reason.includes('vision')), 'rejection should expose missing vision capability')
console.log('model capability smoke passed')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function config() {
  return {
    providers: {
      cheap: {
        name: 'Cheap Test Provider',
        baseURL: 'https://cheap.example.invalid/v1',
        model: 'cheap-model',
        protocol: 'openai-chat-completions',
        auth: { type: 'none' },
        capabilities: { tools: true, vision: false, streaming: true, reasoning: true, contextWindowTokens: 128000 },
      },
      vision: {
        name: 'Vision Test Provider',
        baseURL: 'https://vision.example.invalid/v1',
        model: 'vision-model',
        protocol: 'openai-chat-completions',
        auth: { type: 'none' },
        capabilities: { tools: true, vision: true, streaming: false, reasoning: true, contextWindowTokens: 96000 },
      },
      small: {
        name: 'Small Test Provider',
        baseURL: 'https://small.example.invalid/v1',
        model: 'small-model',
        protocol: 'openai-chat-completions',
        auth: { type: 'none' },
        capabilities: { tools: false, vision: false, streaming: false, reasoning: false, contextWindowTokens: 8000 },
      },
    },
    model: { provider: 'cheap', name: 'cheap-model' },
  }
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}