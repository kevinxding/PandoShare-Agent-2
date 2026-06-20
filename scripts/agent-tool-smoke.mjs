#!/usr/bin/env node
const { AgentSession } = await import('../dist/src/services/agent/index.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { createTextResult } = await import('../dist/src/Tool.js')

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

const context = {
  cwd: process.cwd(),
  sessionId: 'agent-tool-smoke',
  permissionMode: 'default',
}

let requestCount = 0
const session = new AgentSession({
  config: {
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
  },
  fetch: fakeFetch,
})

const result = await session.runTurn({
  prompt: 'Use echo with pong, then answer with the result.',
  toolRegistry: registry,
  toolContext: context,
  maxToolRounds: 2,
})

assert(result.finalText === 'tool said pong', `unexpected final text: ${result.finalText}`)
assert(result.toolCalls.length === 1, `expected 1 tool call, got ${result.toolCalls.length}`)
assert(result.toolResults.length === 1, `expected 1 tool result, got ${result.toolResults.length}`)
assert(result.toolResults[0]?.content === 'pong', `unexpected tool result: ${result.toolResults[0]?.content}`)
assert(requestCount === 2, `expected 2 model requests, got ${requestCount}`)

console.log('agent tool smoke passed')
console.log(`finalText: ${result.finalText}`)
console.log(`toolCalls: ${result.toolCalls.length}`)
console.log(`toolResults: ${result.toolResults.length}`)

async function fakeFetch(_url, init) {
  requestCount += 1
  const body = JSON.parse(String(init.body ?? '{}'))

  if (requestCount === 1) {
    assert(Array.isArray(body.tools) && body.tools.length === 1, 'first request must expose the echo tool')
    assert(body.tools[0]?.function?.name === 'echo', 'first request must expose echo by name')
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

  if (requestCount === 2) {
    const toolMessage = body.messages?.find(
      message =>
        message.role === 'tool' &&
        message.tool_call_id === 'call_echo_1' &&
        message.content === 'pong',
    )
    assert(toolMessage, 'second request must include paired tool output')
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

  throw new Error(`unexpected request count: ${requestCount}`)
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
