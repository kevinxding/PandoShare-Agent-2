#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { QueryEngine } = await import('../dist/src/QueryEngine.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')
const { createTextResult } = await import('../dist/src/Tool.js')
const { createToolRegistry } = await import('../dist/src/tools.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-tool-result-storage-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeLargeToolResultStorage(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('tool result storage smoke passed')

async function smokeLargeToolResultStorage(workspaceRoot) {
  const fullOutput = [
    'large-output-start',
    'x'.repeat(600),
    'large-output-tail-should-be-on-disk',
  ].join('\n')
  const registry = createToolRegistry([
    {
      name: 'large_output',
      description: 'Return a large text output.',
      safety: 'read_only',
      isReadOnly() {
        return true
      },
      execute(toolUse) {
        return createTextResult(toolUse.id, fullOutput)
      },
    },
  ])

  let requestCount = 0
  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId: 'tool-result-storage-session',
    title: 'tool result storage smoke',
    config: fakeConfig(),
    registry,
    maxToolRounds: 2,
    toolResultStorage: {
      inlineCharLimit: 200,
      previewChars: 80,
    },
    fetch: async (_url, init) => {
      requestCount += 1
      const body = JSON.parse(String(init.body ?? '{}'))

      if (requestCount === 1) {
        assert(Array.isArray(body.tools) && body.tools.length === 1, 'first request must expose large_output tool')
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_large_output',
                    type: 'function',
                    function: {
                      name: 'large_output',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        })
      }

      if (requestCount === 2) {
        const requestText = JSON.stringify(body.messages)
        assert(requestText.includes('[persisted tool result]'), 'second request should include persisted result marker')
        assert(requestText.includes('fullOutputPath: .pandoshare/threads/'), 'second request should include stored path')
        assert(requestText.includes('large-output-start'), 'second request should include preview')
        assert(!requestText.includes('large-output-tail-should-be-on-disk'), 'second request should not inline full output tail')
        return jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'large output stored',
              },
            },
          ],
        })
      }

      throw new Error(`unexpected request count: ${requestCount}`)
    },
  })

  const result = await engine.run('Call large_output and then answer.')
  assert(result.finalText === 'large output stored', 'turn should complete after stored result')
  assert(requestCount === 2, `expected 2 model requests, got ${requestCount}`)

  const threadId = engine.threadId()
  assert(threadId, 'engine should expose thread id')
  const store = new LocalThreadStore(workspaceRoot)
  const messages = await store.readMessages(threadId)
  const toolMessage = messages.find(message => message.role === 'tool' && message.toolCallId === 'call_large_output')
  assert(toolMessage, 'persisted messages should include tool output')
  assert(toolMessage.content.includes('[persisted tool result]'), 'tool message should contain persisted marker')
  assert(!toolMessage.content.includes('large-output-tail-should-be-on-disk'), 'tool message should not contain full output tail')

  const events = await store.readEvents(threadId)
  const toolResultEvent = events.find(event => event.type === 'tool_result' && event.toolUseId === 'call_large_output')
  assert(toolResultEvent?.metadata?.toolResultStorage, 'tool_result event should include storage metadata')
  const storage = toolResultEvent.metadata.toolResultStorage
  assert(storage.stored === true, 'storage metadata should mark stored=true')
  assert(typeof storage.relativePath === 'string', 'storage metadata should include relativePath')

  const storedText = await readFile(resolve(workspaceRoot, storage.relativePath), 'utf8')
  assert(storedText.includes('large-output-tail-should-be-on-disk'), 'stored file should contain full output tail')
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
