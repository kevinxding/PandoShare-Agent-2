#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { QueryEngine } = await import('../dist/src/QueryEngine.js')
const { createDefaultToolRegistry } = await import('../dist/src/tools.js')
const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-harness-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await seedProject(smokeRoot)
  const approvals = []
  const forwardedEvents = []
  let requestCount = 0
  const engine = new QueryEngine({
    cwd: smokeRoot,
    sessionId: 'harness-smoke-session',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 6,
    fetch: async (_url, init) => {
      requestCount += 1
      return fakeModelResponse(requestCount, init)
    },
    requestToolApproval(request) {
      approvals.push(request)
      return {
        approved: true,
        reason: `harness smoke approved ${request.toolName}`,
      }
    },
    onEvent(event) {
      forwardedEvents.push(event)
    },
    toolResultStorage: {
      enabled: true,
      inlineCharLimit: 10_000,
      previewChars: 600,
    },
  })

  const output = await engine.run([
    'Fix the bug in this project.',
    'Use shell_command to run node test.mjs.',
    'If the test fails after a change, inspect the failure and continue until it passes.',
  ].join(' '))

  assert(output.finalText === 'Harness smoke fixed the bug and verified the test.', `unexpected final text: ${output.finalText}`)
  assert(requestCount === 7, `expected 7 model requests, got ${requestCount}`)
  assert(output.agent?.rounds === 6, `expected 6 tool rounds, got ${output.agent?.rounds}`)
  assert(output.toolResults.length === 6, `expected 6 tool results, got ${output.toolResults.length}`)
  assert(output.toolResults.some(result => !result.ok), 'tool results should include failing test results')
  assert(output.toolResults.some(result => result.ok && result.content.includes('tests passed')), 'tool results should include passing test result')
  const failedShellResults = output.toolResults.filter(result => !result.ok && result.metadata?.toolName === 'shell_command')
  assert(failedShellResults.length === 2, `expected two structured failing shell results, got ${failedShellResults.length}`)
  assert(
    failedShellResults.every(result => result.metadata?.code === 'process_exit_nonzero' && result.metadata?.category === 'process'),
    'failing shell results should include structured process failure metadata',
  )

  const finalSource = await readFile(resolve(smokeRoot, 'calculator.js'), 'utf8')
  assert(finalSource.includes('return a + b'), 'calculator.js should contain the final fix')
  assert(!finalSource.includes('return a + b + 1'), 'calculator.js should not keep the first bad fix')
  assert(!finalSource.includes('return a - b'), 'calculator.js should not keep the original bug')

  const approvalNames = approvals.map(request => request.toolName)
  assert(approvalNames.filter(name => name === 'shell_command').length === 3, 'shell_command should require approval three times')
  assert(approvalNames.filter(name => name === 'apply_patch').length === 2, 'apply_patch should require approval twice')
  assert(approvals.every(request => request.approvalPolicy === 'on-request'), 'all approvals should use on-request policy')

  const events = engine.events()
  for (const type of [
    'run_started',
    'turn_started',
    'context_built',
    'model_request_started',
    'model_response_completed',
    'tool_call_started',
    'tool_call_completed',
    'approval_requested',
    'approval_completed',
    'turn_completed',
    'run_completed',
  ]) {
    assert(events.some(event => event.type === type), `event stream should include ${type}`)
  }
  assert(events.filter(event => event.type === 'approval_completed' && event.approved).length >= 5, 'approved events should be recorded')
  assert(events.filter(event => event.type === 'tool_call_completed' && event.toolName === 'shell_command').length === 3, 'shell events should be recorded')
  assert(
    events.some(event =>
      event.type === 'tool_call_completed' &&
      event.toolName === 'shell_command' &&
      !event.ok &&
      event.metadata?.code === 'process_exit_nonzero' &&
      event.metadata?.category === 'process'
    ),
    'event stream should include structured process failure metadata',
  )
  assert(forwardedEvents.length === events.length, 'onEvent should receive the same event count as recorder')

  const threadId = engine.threadId()
  assert(threadId, 'engine should expose a thread id')
  const store = new LocalThreadStore(smokeRoot)
  const summary = await store.readThreadSummary(threadId)
  const runLedger = await store.readRunLedger({ threadId })
  const startedRun = runLedger.find(entry => entry.status === 'started')
  const completedRun = runLedger.find(entry => entry.status === 'completed')
  assert(summary.messageCount >= 13, `thread should persist model/tool messages, got ${summary.messageCount}`)
  assert(summary.eventCount === events.length, `thread should persist all events, got ${summary.eventCount}/${events.length}`)
  assert(summary.checkpointCount === 1, `thread should persist one checkpoint, got ${summary.checkpointCount}`)
  assert(startedRun, 'run ledger should include started entry')
  assert(completedRun, 'run ledger should include completed entry')
  assert(completedRun.toolCallCount === 6, `run ledger should count 6 tool calls, got ${completedRun.toolCallCount}`)
  assert(completedRun.toolResultCount === 6, `run ledger should count 6 tool results, got ${completedRun.toolResultCount}`)
  assert(completedRun.failedToolResultCount === 2, `run ledger should count 2 failed tool results, got ${completedRun.failedToolResultCount}`)
  assert(completedRun.approvalRequestCount >= 5, `run ledger should count approvals, got ${completedRun.approvalRequestCount}`)
  assert(completedRun.resourceUsage?.heapUsedBytes > 0, 'run ledger should include resource usage')

  console.log('harness smoke passed')
  console.log(`thread: ${threadId}`)
  console.log(`modelRequests: ${requestCount}`)
  console.log(`approvals: ${approvals.length}`)
  console.log(`events: ${events.length}`)
  console.log(`runLedger: ${runLedger.length}`)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

async function seedProject(workspaceRoot) {
  await writeFile(
    resolve(workspaceRoot, 'calculator.js'),
    [
      'export function add(a, b) {',
      '  return a - b',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    resolve(workspaceRoot, 'test.mjs'),
    [
      "import assert from 'node:assert/strict'",
      "import { add } from './calculator.js'",
      '',
      "assert.equal(add(2, 3), 5, 'add should add two numbers')",
      "assert.equal(add(-1, 1), 0, 'add should handle negative numbers')",
      "console.log('tests passed')",
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    resolve(workspaceRoot, 'package.json'),
    JSON.stringify({ type: 'module' }, null, 2),
    'utf8',
  )
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
    permissions: {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'read-only',
    },
  }
}

function fakeModelResponse(requestCount, init) {
  const body = JSON.parse(String(init.body ?? '{}'))
  assert(Array.isArray(body.tools) && body.tools.some(tool => tool.function?.name === 'shell_command'), 'model request should expose shell_command')
  assert(Array.isArray(body.tools) && body.tools.some(tool => tool.function?.name === 'apply_patch'), 'model request should expose apply_patch')

  switch (requestCount) {
    case 1:
      assert(latestUserText(body).includes('Fix the bug'), 'first request should include the user task')
      return jsonResponse(toolCallResponse('call_test_initial', 'shell_command', {
        command: 'node test.mjs',
        timeoutMs: 5000,
        maxOutputChars: 4000,
      }))
    case 2:
      assert(lastToolText(body).includes('AssertionError'), 'second request should include the initial test failure')
      return jsonResponse(toolCallResponse('call_read_source', 'file_read', {
        path: 'calculator.js',
      }))
    case 3:
      assert(lastToolText(body).includes('return a - b'), 'third request should include the buggy source')
      return jsonResponse(toolCallResponse('call_patch_wrong', 'apply_patch', {
        path: 'calculator.js',
        oldText: 'return a - b',
        newText: 'return a + b + 1',
      }))
    case 4:
      assert(lastToolText(body).includes('replacements'), 'fourth request should include the first patch result')
      return jsonResponse(toolCallResponse('call_test_wrong', 'shell_command', {
        command: 'node test.mjs',
        timeoutMs: 5000,
        maxOutputChars: 4000,
      }))
    case 5:
      assert(lastToolText(body).includes('actual') || lastToolText(body).includes('AssertionError'), 'fifth request should include the second test failure')
      return jsonResponse(toolCallResponse('call_patch_fixed', 'apply_patch', {
        path: 'calculator.js',
        oldText: 'return a + b + 1',
        newText: 'return a + b',
      }))
    case 6:
      assert(lastToolText(body).includes('replacements'), 'sixth request should include the final patch result')
      return jsonResponse(toolCallResponse('call_test_final', 'shell_command', {
        command: 'node test.mjs',
        timeoutMs: 5000,
        maxOutputChars: 4000,
      }))
    case 7:
      assert(lastToolText(body).includes('tests passed'), 'final request should include the passing test output')
      return jsonResponse(textResponse('Harness smoke fixed the bug and verified the test.'))
    default:
      throw new Error(`unexpected model request count: ${requestCount}`)
  }
}

function toolCallResponse(id, name, input) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name,
                arguments: JSON.stringify(input),
              },
            },
          ],
        },
      },
    ],
    usage: {
      total_tokens: 10,
    },
  }
}

function textResponse(content) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
        },
      },
    ],
    usage: {
      total_tokens: 12,
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

function latestUserText(body) {
  const messages = body.messages ?? []
  return [...messages].reverse().find(message => message.role === 'user')?.content ?? ''
}

function lastToolText(body) {
  const messages = body.messages ?? []
  return [...messages].reverse().find(message => message.role === 'tool')?.content ?? ''
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
