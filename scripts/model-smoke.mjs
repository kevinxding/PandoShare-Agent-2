#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

const root = process.cwd()
const configPath = resolve(root, args.config ?? 'pandoshare.config.json')
const configText = await readOptionalFile(configPath)
const { parseProjectConfig } = await import('../dist/src/services/config/index.js').catch(() => {
  throw new Error('Compiled services are missing. Run `npm run build` first.')
})
const { runModelSmoke } = await import('../dist/src/services/llm/index.js')

const config = configText === undefined ? {} : parseProjectConfig(configText, configPath)
const llm = await import('../dist/src/services/llm/index.js')
const configService = await import('../dist/src/services/config/index.js')

const result = await runModelSmoke({
  config,
  online: args.online,
  provider: args.provider,
  model: args.model,
  prompt: args.prompt,
  maxTokens: args.maxTokens,
})
const diagnostics = !args.online && !args.provider
  ? await runOfflineDiagnostics({ llm, configService })
  : undefined

if (args.json) {
  console.log(JSON.stringify({ ...result, diagnostics }, null, 2))
} else {
  printResult(result)
  if (diagnostics) printDiagnostics(diagnostics)
}

function parseArgs(argv) {
  const parsed = {
    online: false,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case 'model':
      case 'test':
        break
      case '--online':
        parsed.online = true
        break
      case '--offline':
        parsed.online = false
        break
      case '--json':
        parsed.json = true
        break
      case '--help':
      case '-h':
        parsed.help = true
        break
      case '--config':
        parsed.config = requiredValue(argv, (index += 1), arg)
        break
      case '--provider':
        parsed.provider = requiredValue(argv, (index += 1), arg)
        break
      case '--model':
        parsed.model = requiredValue(argv, (index += 1), arg)
        break
      case '--prompt':
        parsed.prompt = requiredValue(argv, (index += 1), arg)
        break
      case '--max-tokens':
        parsed.maxTokens = parsePositiveInt(requiredValue(argv, (index += 1), arg), arg)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

async function readOptionalFile(path) {
  try {
    await access(path)
  } catch {
    return undefined
  }
  return readFile(path, 'utf8')
}

function printResult(result) {
  console.log(`mode: ${result.mode}`)
  console.log(`provider: ${result.prepared.provider}`)
  console.log(`model: ${result.prepared.model}`)
  console.log(`protocol: ${result.prepared.protocol}`)
  console.log(`url: ${result.prepared.url}`)
  console.log(`headers: ${result.prepared.headerNames.join(', ') || '(none)'}`)
  console.log(`capabilities: ${formatCapabilities(result.capabilities)}`)
  if (result.prepared.missingAuthEnv?.length) {
    console.log(`auth env: ${result.prepared.missingAuthEnv.join(', ')}`)
  }
  if (result.response) {
    console.log(`text: ${result.response.text}`)
    console.log(`usage: ${result.response.hasUsage ? 'present' : 'missing'}`)
  }
}

async function runOfflineDiagnostics({ llm, configService }) {
  const matrix = []
  for (const fixture of providerFixtures()) {
    const result = await llm.runModelSmoke({
      config: fixture.config,
      provider: fixture.provider,
      model: fixture.model,
      online: false,
    })
    const resolved = configService.resolveDefaultModel({
      ...fixture.config,
      model: {
        provider: fixture.provider,
        name: fixture.model,
      },
    })
    assert(result.prepared.provider === fixture.provider, `provider matrix mismatch for ${fixture.provider}`)
    assert(result.capabilities.contextWindowTokens > 0, `provider ${fixture.provider} should declare context window`)
    assert(result.capabilities.tools === resolved.provider.capabilities.tools, `provider ${fixture.provider} should expose shared capabilities`)
    matrix.push({
      provider: fixture.provider,
      model: result.prepared.model,
      protocol: result.prepared.protocol,
      url: result.prepared.url,
      capabilities: result.capabilities,
      authEnv: result.prepared.missingAuthEnv ?? [],
    })
  }

  const errors = await verifyErrorClassification(llm)
  const streaming = await verifyStreaming(llm)
  return {
    providerMatrix: matrix,
    errorClassification: errors,
    streaming,
  }
}

function providerFixtures() {
  return [
    {
      provider: 'openai',
      model: 'gpt-5.5',
      config: {},
    },
    {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      config: {},
    },
    {
      provider: 'minimax-cn',
      model: 'MiniMax-M3',
      config: {},
    },
    {
      provider: 'custom',
      model: 'custom-smoke-model',
      config: {
        providers: {
          custom: {
            baseURL: 'https://example.invalid/v1',
            model: 'custom-smoke-model',
            protocol: 'openai-chat-completions',
            auth: { type: 'none' },
            capabilities: {
              tools: true,
              contextWindowTokens: 64000,
            },
          },
        },
      },
    },
  ]
}

async function verifyErrorClassification(llm) {
  const request = llm.createModelSmokeRequest({
    config: {
      model: {
        provider: 'custom',
        name: 'custom-smoke-model',
      },
      providers: {
        custom: {
          baseURL: 'https://example.invalid/v1',
          model: 'custom-smoke-model',
          protocol: 'openai-chat-completions',
          auth: { type: 'none' },
        },
      },
    },
  })
  const checks = [
    {
      name: 'auth_failed',
      run: () => llm.generateText(request, {
        fetch: async () => jsonResponse({ error: { message: 'invalid api key' } }, 401, 'Unauthorized'),
        retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
      }),
      category: 'auth_failed',
      retryable: false,
    },
    {
      name: 'rate_limited',
      run: () => llm.generateText(request, {
        fetch: async () => jsonResponse({ error: { message: 'rate limit exceeded' } }, 429, 'Too Many Requests'),
        retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
      }),
      category: 'rate_limited',
      retryable: true,
    },
    {
      name: 'context_too_long',
      run: () => llm.generateText(request, {
        fetch: async () => jsonResponse({ error: { message: 'maximum context length exceeded' } }, 400, 'Bad Request'),
        retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
      }),
      category: 'context_too_long',
      retryable: false,
    },
    {
      name: 'provider_invalid_response',
      run: () => llm.generateText(request, {
        fetch: async () => new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
        retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
      }),
      category: 'provider_invalid_response',
      retryable: false,
    },
    {
      name: 'network_error',
      run: () => llm.generateText(request, {
        fetch: async () => {
          throw new Error('socket closed')
        },
        retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
      }),
      category: 'network_error',
      retryable: true,
    },
  ]

  const results = []
  for (const check of checks) {
    try {
      await check.run()
      throw new Error(`expected ${check.name} to throw`)
    } catch (error) {
      assert(error?.name === 'LLMProviderError', `${check.name} should throw LLMProviderError`)
      assert(error.category === check.category, `${check.name} category should be ${check.category}, got ${error.category}`)
      assert(error.retryable === check.retryable, `${check.name} retryable should be ${check.retryable}`)
      results.push({
        name: check.name,
        category: error.category,
        retryable: error.retryable,
      })
    }
  }
  const retryable = await verifyRetrySuccess(llm, request)
  results.push(retryable)
  const nonRetryable = await verifyNonRetryableDoesNotRetry(llm, request)
  results.push(nonRetryable)
  return results
}

async function verifyRetrySuccess(llm, request) {
  let attempts = 0
  const retryEvents = []
  const response = await llm.generateText(request, {
    retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
    onRetry: event => retryEvents.push(event),
    fetch: async () => {
      attempts += 1
      if (attempts === 1) return jsonResponse({ error: { message: 'server overloaded' } }, 503, 'Service Unavailable')
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'retry ok',
            },
          },
        ],
        usage: { total_tokens: 3 },
      }, 200, 'OK')
    },
  })
  assert(attempts === 2, `retry_success should use 2 attempts, got ${attempts}`)
  assert(response.text === 'retry ok', `retry_success text should be retry ok, got ${response.text}`)
  assert(retryEvents.length === 1, `retry_success should emit 1 retry event, got ${retryEvents.length}`)
  assert(retryEvents[0]?.category === 'provider_error', `retry_success event category should be provider_error, got ${retryEvents[0]?.category}`)
  assert(retryEvents[0]?.attempt === 1 && retryEvents[0]?.nextAttempt === 2, 'retry_success event should include attempt counters')
  return {
    name: 'retry_success',
    category: 'provider_error',
    retryable: true,
    attempts,
    retryEvents: retryEvents.length,
  }
}

async function verifyNonRetryableDoesNotRetry(llm, request) {
  let attempts = 0
  try {
    await llm.generateText(request, {
      retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
      fetch: async () => {
        attempts += 1
        return jsonResponse({ error: { message: 'invalid api key' } }, 401, 'Unauthorized')
      },
    })
    throw new Error('expected non-retryable auth error to throw')
  } catch (error) {
    assert(error?.name === 'LLMProviderError', 'non_retryable_no_retry should throw LLMProviderError')
    assert(error.category === 'auth_failed', `non_retryable_no_retry category should be auth_failed, got ${error.category}`)
    assert(attempts === 1, `non_retryable_no_retry should use 1 attempt, got ${attempts}`)
    return {
      name: 'non_retryable_no_retry',
      category: error.category,
      retryable: error.retryable,
      attempts,
    }
  }
}

async function verifyStreaming(llm) {
  const request = llm.createModelSmokeRequest({
    config: {
      model: {
        provider: 'custom',
        name: 'custom-stream-model',
      },
      providers: {
        custom: {
          baseURL: 'https://example.invalid/v1',
          model: 'custom-stream-model',
          protocol: 'openai-chat-completions',
          auth: { type: 'none' },
          capabilities: {
            streaming: true,
          },
        },
      },
    },
  })
  let attempts = 0
  const retryEvents = []
  const events = []
  for await (const event of llm.streamText(request, {
    retry: { maxRetries: 2, initialDelayMs: 0, jitter: false },
    onRetry: retry => retryEvents.push(retry),
    fetch: async (_url, init) => {
      attempts += 1
      const body = JSON.parse(String(init.body ?? '{}'))
      assert(body.stream === true, 'streamText should send stream=true')
      if (attempts === 1) {
        return jsonResponse({ error: { message: 'server overloaded' } }, 503, 'Service Unavailable')
      }
      return new Response([
        sseRecord({ choices: [{ delta: { content: 'hello ' } }] }),
        sseRecord({ choices: [{ delta: { content: 'stream' } }], usage: { total_tokens: 2 } }),
        sseRecord({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_echo',
                    type: 'function',
                    function: {
                      name: 'echo',
                      arguments: '{"text"',
                    },
                  },
                ],
              },
            },
          ],
        }),
        sseRecord({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ':"pong"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        'data: [DONE]\n\n',
      ].join(''), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      })
    },
  })) {
    events.push(event)
  }

  const deltas = events.filter(event => event.type === 'text_delta').map(event => event.delta)
  const completed = events.find(event => event.type === 'completed')
  const toolCall = completed?.toolCalls?.[0]
  assert(attempts === 2, `stream_text should retry once, got attempts=${attempts}`)
  assert(retryEvents.length === 1, `stream_text should emit one retry event, got ${retryEvents.length}`)
  assert(deltas.join('') === 'hello stream', `stream_text deltas mismatch: ${deltas.join('')}`)
  assert(completed?.text === 'hello stream', `stream_text completed text mismatch: ${completed?.text}`)
  assert(toolCall?.id === 'call_echo', `stream_text should expose tool call id, got ${toolCall?.id}`)
  assert(toolCall?.name === 'echo', `stream_text should expose tool call name, got ${toolCall?.name}`)
  assert(toolCall?.input?.text === 'pong', `stream_text should merge tool call arguments, got ${JSON.stringify(toolCall?.input)}`)
  assert(completed?.usage?.total_tokens === 2, 'stream_text should expose final usage')
  return {
    name: 'stream_text',
    attempts,
    retryEvents: retryEvents.length,
    deltas: deltas.length,
    toolCalls: completed.toolCalls?.length ?? 0,
    text: completed.text,
  }
}

function jsonResponse(body, status, statusText) {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function sseRecord(body) {
  return `data: ${JSON.stringify(body)}\n\n`
}

function printDiagnostics(diagnostics) {
  console.log('provider matrix:')
  for (const item of diagnostics.providerMatrix) {
    console.log(`- ${item.provider}/${item.model}: ${item.protocol}, ${formatCapabilities(item.capabilities)}`)
  }
  console.log('error classification:')
  for (const item of diagnostics.errorClassification) {
    console.log(`- ${item.name}: ${item.category}, retryable=${item.retryable}`)
  }
  console.log('streaming:')
  console.log(`- ${diagnostics.streaming.name}: attempts=${diagnostics.streaming.attempts}, deltas=${diagnostics.streaming.deltas}, toolCalls=${diagnostics.streaming.toolCalls}`)
}

function formatCapabilities(capabilities) {
  return [
    `tools=${capabilities.tools}`,
    `vision=${capabilities.vision}`,
    `streaming=${capabilities.streaming}`,
    `reasoning=${capabilities.reasoning}`,
    `contextWindowTokens=${capabilities.contextWindowTokens}`,
  ].join(', ')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function printHelp() {
  console.log(`Usage:
  node scripts/model-smoke.mjs [model test] [options]

Options:
  --offline              Prepare a request without auth or network calls. Default.
  --online               Send a real non-streaming request.
  --config <path>        Config file path. Default: pandoshare.config.json.
  --provider <id>        Override model.provider.
  --model <name>         Override model.name.
  --prompt <text>        Override smoke prompt.
  --max-tokens <number>  Override max output tokens.
  --json                 Print JSON result.
  --help                 Show this help.
`)
}
