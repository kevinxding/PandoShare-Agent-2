#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-model-fallback-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const router = core.ModelRouter.fromConfig(config(), { workspaceRoot: smokeRoot, workspaceId: 'default' })
router.updateHealth({ providerId: 'cheap', modelId: 'cheap-model', status: 'rate_limited', retryAfterMs: 30000, rateLimitedUntilMs: Date.now() + 30000 })
const decision = await router.route({ taskType: 'code', preferredProvider: 'cheap' })
assert(decision.selectedProviderId !== 'cheap', 'rate-limited preferred provider should not be selected by default')
assert(decision.rejectedCandidates.some(candidate => candidate.providerId === 'cheap' && candidate.reasons.includes('health_rate_limited')), 'rejection should classify rate limit')
const fallback = await router.planFallback(decision, 'rate_limited')
assert(fallback, 'fallback planner should return an alternate candidate')
assert(router.readMemoryEvents().some(event => event.eventType === 'model_fallback_selected'), 'fallback selection should emit event in memory mode')
console.log('model fallback smoke passed')
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