#!/usr/bin/env node
const { AgentSession } = await import('../dist/src/services/agent/index.js')
const { createEventRecorder } = await import('../dist/src/services/events/index.js')
const { createTextResult } = await import('../dist/src/Tool.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')

const registry = createToolRegistry([
  {
    name: 'echo',
    description: 'Return the provided text.',
    safety: 'read_only',
    execute(toolUse) {
      return createTextResult(toolUse.id, String(toolUse.input.text ?? ''))
    },
  },
  {
    name: 'external_probe',
    description: 'External probe.',
    safety: 'external_write',
    execute(toolUse) {
      return createTextResult(toolUse.id, 'external-ok')
    },
  },
])

const recorder = createEventRecorder()
const context = {
  cwd: process.cwd(),
  sessionId: 'event-protocol-smoke',
  permissionMode: 'default',
  emitEvent: recorder.emitEvent,
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

await session.runTurn({
  prompt: 'Use echo with pong.',
  toolRegistry: registry,
  toolContext: context,
  maxToolRounds: 2,
})

assertEventTypes([
  'turn_started',
  'model_request_started',
  'model_retry_scheduled',
  'model_response_completed',
  'tool_call_started',
  'tool_result',
  'tool_call_completed',
  'model_request_started',
  'agent_message_delta',
  'agent_message_completed',
  'turn_completed',
])

const toolStarted = recorder.events.find(event => event.type === 'tool_call_started')
assert(toolStarted?.toolName === 'echo', 'tool_call_started should name echo tool')
const retryEvent = recorder.events.find(event => event.type === 'model_retry_scheduled')
assert(retryEvent?.category === 'provider_error', 'model retry event should include provider_error category')
assert(retryEvent?.attempt === 1 && retryEvent?.nextAttempt === 2, 'model retry event should include attempt counters')

const approvalStartCount = recorder.events.length
await collectToolResults(
  runTools(
    [{ id: 'call_external_probe', name: 'external_probe', input: { token: 'secret-value' } }],
    registry,
    context,
  ),
)
const approvalEvents = recorder.events.slice(approvalStartCount)
assert(approvalEvents.some(event => event.type === 'approval_requested'), 'approval_requested event should be emitted')
assert(approvalEvents.some(event => event.type === 'approval_completed' && !event.approved), 'denied approval event should be emitted')
const approvalRequested = approvalEvents.find(event => event.type === 'approval_requested')
assert(approvalRequested?.input.token === '<redacted>', 'approval event input should redact token')

const streamRecorder = createEventRecorder()
const streamContext = {
  cwd: process.cwd(),
  sessionId: 'event-protocol-stream-smoke',
  permissionMode: 'default',
  emitEvent: streamRecorder.emitEvent,
}

let streamRequestCount = 0
const streamSession = new AgentSession({
  config: {
    model: {
      provider: 'fake-streaming-openai-compatible',
      name: 'fake-stream-model',
    },
    providers: {
      'fake-streaming-openai-compatible': {
        baseURL: 'https://example.invalid/v1',
        model: 'fake-stream-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
        capabilities: {
          streaming: true,
        },
      },
    },
  },
  fetch: fakeStreamFetch,
})

const streamResult = await streamSession.runTurn({
  prompt: 'Stream a short answer.',
  toolContext: streamContext,
  stream: true,
})

const streamDeltas = streamRecorder.events
  .filter(event => event.type === 'agent_message_delta')
  .map(event => event.delta)
assert(streamRequestCount === 1, `streaming turn should use one request, got ${streamRequestCount}`)
assert(streamDeltas.length === 2, `streaming turn should emit two deltas, got ${streamDeltas.length}`)
assert(streamDeltas.join('') === 'hello stream', `streaming deltas mismatch: ${streamDeltas.join('')}`)
assert(streamResult.finalText === 'hello stream', `streaming final text mismatch: ${streamResult.finalText}`)
assert(streamRecorder.events.some(event => event.type === 'agent_message_completed'), 'streaming turn should complete assistant message')

console.log('event protocol smoke passed')
console.log(`events: ${recorder.events.length}`)
console.log(`streamEvents: ${streamRecorder.events.length}`)

async function collectToolResults(iterable) {
  const results = []
  for await (const update of iterable) {
    results.push(update.result)
  }
  return results
}

function assertEventTypes(requiredTypes) {
  for (const type of requiredTypes) {
    assert(recorder.events.some(event => event.type === type), `missing event type: ${type}`)
  }
}

async function fakeFetch(_url, init) {
  requestCount += 1
  const body = JSON.parse(String(init.body ?? '{}'))

  if (requestCount === 1) {
    assert(Array.isArray(body.tools) && body.tools.length === 2, 'first request must expose tools')
    return new Response(JSON.stringify({ error: { message: 'temporary overload' } }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  if (requestCount === 2) {
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

  if (requestCount === 3) {
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

async function fakeStreamFetch(_url, init) {
  streamRequestCount += 1
  const body = JSON.parse(String(init.body ?? '{}'))
  assert(body.stream === true, 'streaming agent turn should send stream=true')
  assert(!Array.isArray(body.tools), 'streaming smoke should not expose tools')
  return new Response([
    'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"stream"}}],"usage":{"total_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ].join(''), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
