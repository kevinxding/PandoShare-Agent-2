#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { QueryEngine } = await import('../dist/src/QueryEngine.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-token-budget-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeTokenBudgetContext(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('token budget smoke passed')

async function smokeTokenBudgetContext(workspaceRoot) {
  let requestCount = 0
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'token-budget-session',
    title: 'token budget smoke',
    config: fakeConfig(),
    tokenBudget: {
      contextWindowTokens: 120,
      reserveOutputTokens: 20,
      charsPerToken: 4,
      includeContextMessage: true,
    },
    fetch: async (_url, init) => {
      requestCount += 1
      const body = JSON.parse(String(init.body ?? '{}'))
      const requestText = JSON.stringify(body.messages)
      assert(requestText.includes('<token_budget>'), 'request should include token budget context')
      assert(requestText.includes('Estimated tokens left in this context window'), 'request should include remaining token estimate')
      assert(requestText.includes('Context window: 120 tokens.'), 'request should include configured context window')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'budget visible',
            },
          },
        ],
      })
    },
  })

  const result = await engine.run('Answer briefly.')
  assert(result.finalText === 'budget visible', 'turn should complete')
  assert(requestCount === 1, `expected 1 model request, got ${requestCount}`)

  const threadId = engine.threadId()
  assert(threadId, 'engine should expose thread id')
  const store = new LocalThreadStore(workspaceRoot)
  const messages = await store.readMessages(threadId)
  assert(!JSON.stringify(messages).includes('<token_budget>'), 'persisted messages should not include token budget context')

  const events = await store.readEvents(threadId)
  const contextBuilt = events.find(event => event.type === 'context_built')
  assert(contextBuilt?.tokenBudget?.enabled === true, 'context_built should include enabled token budget stats')
  assert(contextBuilt.tokenBudget.contextMessageIncluded === true, 'token budget stats should report injected context message')
  assert(typeof contextBuilt.tokenBudget.estimatedTokensLeft === 'number', 'token budget stats should include estimated tokens left')

  const checkpoints = await store.readCheckpoints(threadId)
  const latestCheckpoint = checkpoints[checkpoints.length - 1]
  assert(latestCheckpoint?.context?.tokenBudget?.enabled === true, 'checkpoint should include token budget stats')
}

function fakeConfig() {
  return {
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    providers: {
      'fake-openai-compatible': {
        baseURL: 'https://example.invalid/v1',
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
    },
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
