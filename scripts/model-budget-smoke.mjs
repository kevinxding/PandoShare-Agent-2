#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-model-budget-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
const router = core.ModelRouter.fromConfig(config(), { workspaceRoot: smokeRoot, workspaceId: 'default', durable })
const warn = await router.route({ taskType: 'code', contextTokensNeeded: 80, estimatedOutputTokens: 10, budgetPolicy: { maxTotalTokens: 100, warnAtRatio: 0.8, hardLimit: true } })
assert(warn.status === 'selected', 'warning budget route should still select')
assert(warn.budgetDecision.status === 'warning', `expected warning budget, got ${warn.budgetDecision.status}`)
const exceeded = await router.route({ taskType: 'code', contextTokensNeeded: 150, estimatedOutputTokens: 10, budgetPolicy: { maxTotalTokens: 100, hardLimit: true } })
assert(exceeded.status === 'rejected', 'hard budget exceeded should reject')
assert(exceeded.budgetDecision.status === 'exceeded', 'budget decision should be exceeded')
const events = await durable.readEvents()
assert(events.some(event => event.eventType === 'model_budget_warning'), 'budget warning event should be durable')
assert(events.some(event => event.eventType === 'model_budget_exceeded'), 'budget exceeded event should be durable')
console.log('model budget smoke passed')
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