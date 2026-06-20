#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-model-router-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
const router = core.ModelRouter.fromConfig(config(), { workspaceRoot: smokeRoot, workspaceId: 'default', durable })
const decision = await router.route({ taskType: 'code', profileId: 'build', preferredProvider: 'cheap', contextTokensNeeded: 1000 })
assert(decision.status === 'selected', `expected selected route, got ${decision.status}`)
assert(decision.selectedProviderId === 'cheap', `expected cheap provider, got ${decision.selectedProviderId}`)
assert(decision.routeReason.some(reason => reason.code === 'preferred_provider'), 'route should explain preferred provider')
assert(decision.fallbackPlan.candidates.length > 0, 'route should include fallback candidates')
await router.recordRequestStarted(decision)
await router.recordResponseCompleted(decision, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
const events = await durable.readEvents()
assert(events.some(event => event.eventType === 'model_route_requested'), 'route requested event should be durable')
assert(events.some(event => event.eventType === 'model_route_selected'), 'route selected event should be durable')
assert(events.some(event => event.eventType === 'model_usage_recorded'), 'usage event should be durable')
const usage = await router.readUsage()
assert(usage.length === 1 && usage[0].totalTokens === 15, 'usage should be persisted through router')
console.log('model router smoke passed')
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