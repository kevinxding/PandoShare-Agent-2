#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { buildThreadContext } = await import('../dist/src/services/contextBuilder/index.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')
const { QueryEngine } = await import('../dist/src/QueryEngine.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-context-builder-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeDirectContextBuilder()
  await smokeQueryEngineContext(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('context builder smoke passed')

async function smokeDirectContextBuilder() {
  const messages = longHistoryMessages()
  const result = buildThreadContext({
    messages,
    checkpoints: [
      {
        checkpointId: 'checkpoint-direct',
        threadId: 'thread-direct',
        sessionId: 'session-direct',
        createdAtMs: Date.now(),
        messageCount: messages.length,
        eventCount: 1,
        finalTextPreview: 'checkpoint says the task is already oriented',
      },
    ],
    options: {
      maxContextChars: 700,
      minRecentMessages: 4,
      checkpointSummaryChars: 80,
    },
  })

  const text = JSON.stringify(result.initialMessages)
  assert(result.initialMessages.length < messages.length, 'context should not retain full long history')
  assert(text.includes('[context note]'), 'context should insert a context note')
  assert(text.includes('checkpoint says the task is already oriented'), 'context note should include checkpoint preview')
  assert(!text.includes('old-turn-0'), 'oldest messages should be omitted')
  assert(!text.includes('orphan tool result'), 'orphan tool result should be removed')
  assert(text.includes('recent tool result'), 'recent tool result should be retained')
  assert(text.includes('recent final answer'), 'recent final answer should be retained')
  assert(result.stats.orphanedToolResultCount === 1, 'orphaned tool result should be counted')
  assert(result.stats.droppedMessageCount > 0, 'dropped messages should be counted')
  assert(result.stats.checkpointIncluded, 'checkpoint inclusion should be reported')
}

async function smokeQueryEngineContext(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    threadId: 'thread_context_smoke',
    sessionId: 'context-session-1',
    title: 'context smoke',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  const messages = longHistoryMessages()
  await store.writeMessages(record.metadata.threadId, messages)
  await store.appendCheckpoint(
    record.metadata.threadId,
    store.createCheckpoint({
      metadata: record.metadata,
      turnId: 'turn-context-1',
      messageCount: messages.length,
      eventCount: 1,
      finalText: 'checkpoint for query engine context',
    }),
  )

  let inspectedRequest = false
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'context-session-2',
    threadId: record.metadata.threadId,
    config: fakeConfig(),
    context: {
      maxContextChars: 700,
      minRecentMessages: 4,
      checkpointSummaryChars: 80,
    },
    autoCompact: {
      enabled: false,
    },
    fetch: async (_url, init) => {
      inspectedRequest = true
      const body = JSON.parse(String(init.body ?? '{}'))
      const requestText = JSON.stringify(body.messages)

      assert(requestText.includes('[context note]'), 'model request should include context note')
      assert(requestText.includes('recent final answer'), 'model request should retain recent answer')
      assert(requestText.includes('Continue from context smoke'), 'model request should include current prompt')
      assert(!requestText.includes('old-turn-0'), 'model request should omit oldest stored history')
      assert(body.messages.length < messages.length + 1, 'model request should be smaller than full history plus prompt')

      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'continued from bounded context',
            },
          },
        ],
        usage: {
          total_tokens: 5,
        },
      })
    },
  })

  const result = await engine.run('Continue from context smoke.')
  assert(inspectedRequest, 'fake fetch should inspect model request')
  assert(result.finalText === 'continued from bounded context', `unexpected result: ${result.finalText}`)

  const persisted = await store.readMessages(record.metadata.threadId)
  const persistedText = JSON.stringify(persisted)
  assert(persistedText.includes('old-turn-0'), 'full persisted history should keep omitted old messages')
  assert(!persistedText.includes('[context note]'), 'context note should not be persisted into full history')
  assert(persistedText.includes('Continue from context smoke.'), 'new user message should be appended')
  assert(persistedText.includes('continued from bounded context'), 'new assistant message should be appended')

  const events = await store.readEvents(record.metadata.threadId)
  assert(events.some(event => event.type === 'context_built'), 'events should include context_built')
  const checkpoints = await store.readCheckpoints(record.metadata.threadId)
  const latest = checkpoints[checkpoints.length - 1]
  assert(latest?.context?.droppedMessageCount > 0, 'checkpoint should record context stats')
}

function longHistoryMessages() {
  const messages = []
  for (let index = 0; index < 12; index += 1) {
    messages.push({
      role: 'user',
      content: `old-turn-${index} ${'x'.repeat(180)}`,
    })
    messages.push({
      role: 'assistant',
      content: `old-answer-${index} ${'y'.repeat(120)}`,
    })
  }

  messages.push({
    role: 'user',
    content: 'orphan wrapper',
  })
  messages.push({
    role: 'tool',
    toolCallId: 'missing_call',
    content: 'orphan tool result',
  })
  messages.push({
    role: 'assistant',
    content: 'after orphan wrapper',
  })

  messages.push({
    role: 'user',
    content: 'recent tool request',
  })
  messages.push({
    role: 'assistant',
    content: '',
    toolCalls: [
      {
        id: 'call_recent',
        name: 'echo',
        input: {
          text: 'recent',
        },
      },
    ],
  })
  messages.push({
    role: 'tool',
    toolCallId: 'call_recent',
    content: 'recent tool result',
  })
  messages.push({
    role: 'assistant',
    content: 'recent final answer',
  })
  return messages
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
