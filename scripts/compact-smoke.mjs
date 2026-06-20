#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { QueryEngine } = await import('../dist/src/QueryEngine.js')
const { buildThreadContext } = await import('../dist/src/services/contextBuilder/index.js')
const { compactThreadHistory } = await import('../dist/src/services/compact/index.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-compact-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeManualCompaction(smokeRoot)
  await smokeAutoCompact(smokeRoot)
  await smokeNoAutoCompactBelowThreshold(smokeRoot)
  await smokeAutoCompactFailureCircuitBreaker(smokeRoot)
  await smokeReactiveCompact(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('compact smoke passed')

async function smokeManualCompaction(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    threadId: 'thread_manual_compact',
    sessionId: 'manual-session',
    title: 'manual compact',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  const messages = longHistoryMessages('manual')
  await store.writeMessages(record.metadata.threadId, messages)

  let compactRequestInspected = false
  const compaction = await compactThreadHistory({
    store,
    threadId: record.metadata.threadId,
    sessionId: 'manual-session',
    config: fakeConfig(),
    context: {
      maxContextChars: 900,
      minRecentMessages: 4,
    },
    trigger: 'manual',
    reason: 'manual',
    phase: 'standalone',
    emitEvent: event => store.appendEvent(record.metadata.threadId, event),
    fetch: async (_url, init) => {
      compactRequestInspected = true
      const body = JSON.parse(String(init.body ?? '{}'))
      const requestText = JSON.stringify(body.messages)
      assert(requestText.includes('manual-old-turn-0'), 'compact request should include old history')
      assert(!requestText.includes('sk-manual-secret-value'), 'compact request should redact sk-style secrets')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Manual summary mentions <redacted> and key facts.',
            },
          },
        ],
      })
    },
  })

  assert(compactRequestInspected, 'manual compact should call summarizer')
  assert(compaction.status === 'completed', 'manual compaction should complete')
  assert(compaction.coveredMessageCount > 0, 'manual compaction should cover old messages')
  assert(compaction.retainedMessageCount > 0, 'manual compaction should retain recent messages')

  const persisted = await store.readMessages(record.metadata.threadId)
  assert(persisted.length === messages.length, 'messages.jsonl should remain unchanged')

  const compactions = await store.readCompactions(record.metadata.threadId)
  assert(compactions.length === 1, `expected 1 compaction, got ${compactions.length}`)

  const context = buildThreadContext({
    messages: persisted,
    compactions,
    options: {
      maxContextChars: 900,
      minRecentMessages: 4,
    },
  })
  const contextText = JSON.stringify(context.initialMessages)
  assert(contextText.includes('[compaction summary]'), 'context should include compaction summary')
  assert(contextText.includes('Manual summary mentions <redacted>'), 'context should include summary text')
  assert(!contextText.includes('manual-old-turn-0'), 'context should omit raw compacted prefix')
  assert(contextText.includes('manual-recent tool result'), 'context should retain recent tool result')
  assert(contextText.includes('manual-recent final answer'), 'context should retain recent final answer')
  assert(context.stats.compactionSummaryIncluded, 'context stats should report compaction summary')
  assert(context.stats.compactionId === compaction.compactionId, 'context stats should report compaction id')

  const toolCallMessage = context.initialMessages.find(message => message.toolCalls?.some(toolCall => toolCall.id === 'call_manual_recent'))
  const toolResultMessage = context.initialMessages.find(message => message.role === 'tool' && message.toolCallId === 'call_manual_recent')
  assert(Boolean(toolCallMessage) === Boolean(toolResultMessage), 'tool call rectangle should not be split')

  const exportedJson = JSON.parse(await store.exportThread(record.metadata.threadId, 'json'))
  assert(exportedJson.compactions.length === 1, 'json export should include compactions')
  assert(JSON.stringify(exportedJson).includes('<redacted>'), 'json export should include redacted summary content')

  const exportedMarkdown = await store.exportThread(record.metadata.threadId, 'md')
  assert(exportedMarkdown.includes('## Compactions'), 'markdown export should include compactions section')
}

async function smokeAutoCompact(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    threadId: 'thread_auto_compact',
    sessionId: 'auto-session-1',
    title: 'auto compact',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  await store.writeMessages(record.metadata.threadId, longHistoryMessages('auto'))

  let requestCount = 0
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'auto-session-2',
    threadId: record.metadata.threadId,
    config: fakeConfig(),
    context: {
      maxContextChars: 900,
      minRecentMessages: 4,
    },
    fetch: async (_url, init) => {
      requestCount += 1
      const body = JSON.parse(String(init.body ?? '{}'))
      const requestText = JSON.stringify(body.messages)
      if (requestCount === 1) {
        assert(requestText.includes('Summarize the following'), 'first request should be compaction')
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Auto summary.',
              },
            },
          ],
        })
      }

      assert(requestText.includes('[compaction summary]'), 'post-auto request should include compaction summary')
      assert(requestText.includes('continue after auto compact'), 'post-auto request should include current prompt')
      assert(!requestText.includes('auto-old-turn-0'), 'post-auto request should omit raw compacted prefix')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'continued after auto compact',
            },
          },
        ],
      })
    },
  })

  const result = await engine.run('continue after auto compact')
  assert(result.finalText === 'continued after auto compact', 'auto compact turn should complete')
  assert(requestCount === 2, `expected compact + turn requests, got ${requestCount}`)

  const compactions = await store.readCompactions(record.metadata.threadId)
  assert(compactions.length === 1, `expected 1 auto compaction, got ${compactions.length}`)
  const events = await store.readEvents(record.metadata.threadId)
  assert(events.some(event => event.type === 'compaction_started'), 'events should include compaction_started')
  assert(events.some(event => event.type === 'compaction_completed'), 'events should include compaction_completed')
}

async function smokeNoAutoCompactBelowThreshold(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    threadId: 'thread_no_auto_compact',
    sessionId: 'no-auto-session-1',
    title: 'no auto compact',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  await store.writeMessages(record.metadata.threadId, [
    {
      role: 'user',
      content: 'short history',
    },
    {
      role: 'assistant',
      content: 'short answer',
    },
  ])

  let requestCount = 0
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'no-auto-session-2',
    threadId: record.metadata.threadId,
    config: fakeConfig(),
    context: {
      maxContextChars: 10_000,
      minRecentMessages: 4,
    },
    fetch: async (_url, init) => {
      requestCount += 1
      const body = JSON.parse(String(init.body ?? '{}'))
      assert(!JSON.stringify(body.messages).includes('Summarize the following'), 'short thread should not compact')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'short continued',
            },
          },
        ],
      })
    },
  })

  await engine.run('continue short thread')
  assert(requestCount === 1, `expected only normal request, got ${requestCount}`)
  assert((await store.readCompactions(record.metadata.threadId)).length === 0, 'short thread should have no compactions')
}

async function smokeAutoCompactFailureCircuitBreaker(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    threadId: 'thread_compact_failures',
    sessionId: 'failure-session-1',
    title: 'compact failures',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  await store.writeMessages(record.metadata.threadId, longHistoryMessages('failure'))

  let compactAttempts = 0
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'failure-session-2',
    threadId: record.metadata.threadId,
    config: fakeConfig(),
    context: {
      maxContextChars: 900,
      minRecentMessages: 4,
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}'))
      if (JSON.stringify(body.messages).includes('Summarize the following')) {
        compactAttempts += 1
        throw new Error('summarizer unavailable')
      }
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: `normal answer ${compactAttempts}`,
            },
          },
        ],
      })
    },
  })

  await engine.run('first after compact failure')
  await engine.run('second after compact failure')
  await engine.run('third after compact failure')
  await engine.run('fourth after compact failure')

  assert(compactAttempts === 3, `expected circuit breaker after 3 failures, got ${compactAttempts}`)
  const compactions = await store.readCompactions(record.metadata.threadId)
  assert(compactions.filter(compaction => compaction.status === 'failed').length === 3, 'failed compactions should be recorded')
}

async function smokeReactiveCompact(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    threadId: 'thread_reactive_compact',
    sessionId: 'reactive-session-1',
    title: 'reactive compact',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  await store.writeMessages(record.metadata.threadId, longHistoryMessages('reactive'))

  let requestCount = 0
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'reactive-session-2',
    threadId: record.metadata.threadId,
    config: fakeConfig(),
    context: {
      maxContextChars: 900,
      minRecentMessages: 4,
    },
    autoCompact: {
      enabled: false,
    },
    fetch: async (_url, init) => {
      requestCount += 1
      const body = JSON.parse(String(init.body ?? '{}'))
      const requestText = JSON.stringify(body.messages)

      if (requestCount === 1) {
        throw new Error('prompt is too long for the context window')
      }

      if (requestCount === 2) {
        assert(requestText.includes('Summarize the following'), 'second request should compact after context error')
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Reactive summary.',
              },
            },
          ],
        })
      }

      assert(requestText.includes('[compaction summary]'), 'retry should include reactive compaction summary')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'continued after reactive compact',
            },
          },
        ],
      })
    },
  })

  const result = await engine.run('continue after reactive compact')
  assert(result.finalText === 'continued after reactive compact', 'reactive compact retry should complete')
  assert(requestCount === 3, `expected fail + compact + retry, got ${requestCount}`)
  const compactions = await store.readCompactions(record.metadata.threadId)
  assert(compactions.length === 1, `expected 1 reactive compaction, got ${compactions.length}`)
  assert(compactions[0]?.reason === 'retry_after_failure', 'reactive compaction should record retry reason')
}

function longHistoryMessages(prefix) {
  const messages = []
  for (let index = 0; index < 14; index += 1) {
    messages.push({
      role: 'user',
      content: `${prefix}-old-turn-${index} ${'x'.repeat(160)} ${index === 0 ? `sk-${prefix}-secret-value` : ''}`,
    })
    messages.push({
      role: 'assistant',
      content: `${prefix}-old-answer-${index} ${'y'.repeat(120)}`,
    })
  }

  messages.push({
    role: 'user',
    content: `${prefix}-recent tool request`,
  })
  messages.push({
    role: 'assistant',
    content: '',
    toolCalls: [
      {
        id: `call_${prefix}_recent`,
        name: 'echo',
        input: {
          text: `${prefix}-recent`,
        },
      },
    ],
  })
  messages.push({
    role: 'tool',
    toolCallId: `call_${prefix}_recent`,
    content: `${prefix}-recent tool result`,
  })
  messages.push({
    role: 'assistant',
    content: `${prefix}-recent final answer`,
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
