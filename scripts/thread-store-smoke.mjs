#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { QueryEngine } = await import('../dist/src/QueryEngine.js')
const { createTextResult } = await import('../dist/src/Tool.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-thread-store-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeDirectStore(smokeRoot)
  await smokeEnginePersistence(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('thread store smoke passed')

async function smokeDirectStore(workspaceRoot) {
  const store = new LocalThreadStore(workspaceRoot)
  const record = await store.createThread({
    sessionId: 'direct-session',
    title: 'direct thread',
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    goalId: 'goal_thread_smoke',
  })

  await store.appendEvent(record.metadata.threadId, {
    id: 'event-direct-1',
    type: 'turn_started',
    timestampMs: Date.now(),
    sessionId: 'direct-session',
    turnId: 'turn-direct-1',
    promptPreview: 'hello',
  })
  await store.writeMessages(record.metadata.threadId, [
    {
      role: 'user',
      content: 'hello',
    },
    {
      role: 'assistant',
      content: 'world',
    },
  ])
  await store.appendCheckpoint(
    record.metadata.threadId,
    store.createCheckpoint({
      metadata: record.metadata,
      turnId: 'turn-direct-1',
      messageCount: 2,
      eventCount: 1,
      finalText: 'world',
    }),
  )

  const reopened = await store.openThread(record.metadata.threadId, 'direct-session-2')
  const events = await store.readEvents(record.metadata.threadId)
  const messages = await store.readMessages(record.metadata.threadId)
  const checkpoints = await store.readCheckpoints(record.metadata.threadId)

  assert(reopened.metadata.sessionId === 'direct-session-2', 'openThread should update sessionId')
  assert(events.length === 1, `expected 1 event, got ${events.length}`)
  assert(messages.length === 2, `expected 2 messages, got ${messages.length}`)
  assert(checkpoints.length === 1, `expected 1 checkpoint, got ${checkpoints.length}`)
  assert(reopened.metadata.goalId === 'goal_thread_smoke', 'thread metadata should preserve goalId')
  assert(checkpoints[0].goalId === 'goal_thread_smoke', 'checkpoint should preserve goalId')
}

async function smokeEnginePersistence(workspaceRoot) {
  const registry = createToolRegistry([
    {
      name: 'echo',
      description: 'Return the provided text.',
      safety: 'read_only',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
      isReadOnly() {
        return true
      },
      execute(toolUse) {
        return createTextResult(toolUse.id, String(toolUse.input.text ?? ''))
      },
    },
  ])
  const config = fakeConfig()
  const store = new LocalThreadStore(workspaceRoot)
  let firstRunRequestCount = 0

  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'thread-store-run-1',
    config,
    registry,
    maxToolRounds: 2,
    tokenBudget: {
      enabled: false,
    },
    goalId: 'goal_engine_smoke',
    fetch: async (_url, init) => {
      firstRunRequestCount += 1
      const body = JSON.parse(String(init.body ?? '{}'))

      if (firstRunRequestCount === 1) {
        assert(Array.isArray(body.tools) && body.tools.length === 1, 'first request should expose echo tool')
        assert(
          body.messages.length === 1 &&
            body.messages[0]?.role === 'user' &&
            body.messages[0]?.content.includes('Use echo'),
          'new thread should start with only the current user prompt',
        )
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_echo_1',
                    type: 'function',
                    function: {
                      name: 'echo',
                      arguments: JSON.stringify({ text: 'pong' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            total_tokens: 1,
          },
        })
      }

      if (firstRunRequestCount === 2) {
        assert(hasToolMessage(body.messages, 'call_echo_1', 'pong'), 'second request should include tool output')
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'tool said pong',
              },
            },
          ],
          usage: {
            total_tokens: 2,
          },
        })
      }

      throw new Error(`unexpected first run request count: ${firstRunRequestCount}`)
    },
  })

  const firstResult = await engine.run('Use echo with pong, then answer.')
  const threadId = engine.threadId()
  assert(firstResult.finalText === 'tool said pong', `unexpected first result: ${firstResult.finalText}`)
  assert(threadId, 'engine should expose created thread id')

  const firstEvents = await store.readEvents(threadId)
  const firstMessages = await store.readMessages(threadId)
  const firstCheckpoints = await store.readCheckpoints(threadId)
  const firstRunLedger = await store.readRunLedger({ threadId })
  const firstCompletedRun = firstRunLedger.find(entry => entry.status === 'completed')
  assert(firstEvents.some(event => event.type === 'turn_started'), 'events.jsonl should include turn_started')
  assert(firstEvents.some(event => event.type === 'run_started'), 'events.jsonl should include run_started')
  assert(firstEvents.some(event => event.type === 'run_completed'), 'events.jsonl should include run_completed')
  assert(firstEvents.every(event => event.goalId === 'goal_engine_smoke'), 'events should be linked to goalId')
  assert(firstEvents.some(event => event.type === 'tool_call_completed'), 'events.jsonl should include tool_call_completed')
  assert(firstMessages.some(message => message.role === 'tool' && message.content === 'pong'), 'messages.jsonl should include tool output')
  assert(firstCheckpoints.length === 1, `expected 1 checkpoint, got ${firstCheckpoints.length}`)
  assert(firstCheckpoints[0].goalId === 'goal_engine_smoke', 'engine checkpoint should be linked to goalId')
  assert(firstCompletedRun?.toolCallCount === 1, `run ledger should count one tool call, got ${firstCompletedRun?.toolCallCount}`)
  assert(firstCompletedRun?.toolResultCount === 1, `run ledger should count one tool result, got ${firstCompletedRun?.toolResultCount}`)
  assert(firstCompletedRun?.resourceUsage?.rssBytes > 0, 'run ledger should include RSS usage')

  let resumeSawHistory = false
  const resumed = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'thread-store-run-2',
    threadId,
    config,
    registry,
    maxToolRounds: 1,
    tokenBudget: {
      enabled: false,
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}'))
      resumeSawHistory =
        body.messages.some(message => message.role === 'user' && message.content.includes('Use echo')) &&
        body.messages.some(message => message.role === 'tool' && message.content === 'pong') &&
        body.messages.some(message => message.role === 'assistant' && message.content === 'tool said pong')
      assert(resumeSawHistory, 'resume request should include prior conversation history')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'continued with history',
            },
          },
        ],
        usage: {
          total_tokens: 3,
        },
      })
    },
  })

  const secondResult = await resumed.run('Continue.')
  assert(secondResult.finalText === 'continued with history', `unexpected resumed result: ${secondResult.finalText}`)
  assert(resumed.threadId() === threadId, 'resumed engine should keep the same thread id')
  assert(resumeSawHistory, 'resume fetch should inspect restored history')

  const secondMessages = await store.readMessages(threadId)
  const secondCheckpoints = await store.readCheckpoints(threadId)
  const secondRunLedger = await store.readRunLedger({ threadId })
  const completedRuns = secondRunLedger.filter(entry => entry.status === 'completed')
  assert(secondMessages.some(message => message.role === 'assistant' && message.content === 'continued with history'), 'messages should include resumed answer')
  assert(secondCheckpoints.length === 2, `expected 2 checkpoints, got ${secondCheckpoints.length}`)
  assert(completedRuns.length === 2, `run ledger should include two completed runs, got ${completedRuns.length}`)
  assert(completedRuns.every(entry => entry.durationMs >= 0), 'completed run ledger entries should include duration')

  const staleNow = Date.now()
  await store.appendRunLedger({
    runId: 'run_thread_store_stale_started',
    sessionId: 'thread-store-stale',
    threadId,
    cwd: workspaceRoot,
    status: 'started',
    startedAtMs: staleNow - 1000,
    updatedAtMs: staleNow - 1000,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    promptPreview: 'stale run smoke',
    eventCount: 1,
    messageCount: 1,
    toolCallCount: 0,
    toolResultCount: 0,
    failedToolResultCount: 0,
    approvalRequestCount: 0,
  })
  const staleRuns = await store.readStaleRuns({ staleAfterMs: 500, nowMs: staleNow })
  assert(staleRuns.some(entry => entry.runId === 'run_thread_store_stale_started'), 'stale started run should be detected')
  await store.appendRunLedger({
    runId: 'run_thread_store_stale_started',
    sessionId: 'thread-store-stale',
    threadId,
    cwd: workspaceRoot,
    status: 'completed',
    startedAtMs: staleNow - 1000,
    updatedAtMs: staleNow,
    completedAtMs: staleNow,
    durationMs: 1000,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    promptPreview: 'stale run smoke',
    finalTextPreview: 'stale run completed',
    eventCount: 2,
    messageCount: 2,
    toolCallCount: 0,
    toolResultCount: 0,
    failedToolResultCount: 0,
    approvalRequestCount: 0,
  })
  const clearedStaleRuns = await store.readStaleRuns({ staleAfterMs: 500, nowMs: staleNow + 1000 })
  assert(!clearedStaleRuns.some(entry => entry.runId === 'run_thread_store_stale_started'), 'completed run should clear stale started run')
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

function hasToolMessage(messages, toolCallId, content) {
  return messages.some(
    message => message.role === 'tool' && message.tool_call_id === toolCallId && message.content === content,
  )
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
