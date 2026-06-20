#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-model-profile-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const router = core.ModelRouter.fromConfig(config(), { workspaceRoot: smokeRoot, workspaceId: 'default' })
const profiles = router.listProfiles()
assert(profiles.some(profile => profile.profileId === 'build'), 'build profile should be registered')
assert(profiles.some(profile => profile.profileId === 'verifier'), 'verifier profile should be registered')
const verifier = await router.route({ taskType: 'verifier', profileId: 'verifier', sourceProviderId: 'cheap' })
assert(verifier.selectedProviderId !== 'cheap', 'verifier should avoid source provider when alternatives exist')
assert(verifier.rejectedCandidates.some(candidate => candidate.providerId === 'cheap' && candidate.reasons.includes('same_family_for_verifier')), 'verifier route should explain same-family avoidance')
const legacy = router.selectModel({ taskType: 'cheap', preferredProvider: 'cheap' })
assert(legacy.provider.id === 'cheap', 'legacy selectModel should remain synchronous and compatible')
console.log('model profile smoke passed')
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