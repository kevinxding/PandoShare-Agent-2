#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const { startPandoServer } = await import('../dist/src/server/index.js')
const { GatewayRuntime, LocalGatewayStore } = await import('../dist/src/services/gatewayRuntime/index.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-approval-web-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

let llm
let pando
let sse
try {
  llm = await startFakeLlmServer()
  const configPath = resolve(smokeRoot, 'pandoshare.config.json')
  await writeFile(configPath, JSON.stringify(fakeConfig(llm.url), null, 2), 'utf8')
  pando = await startPandoServer({
    cwd: smokeRoot,
    configPath,
    port: 0,
    staticRoot: resolve(root, 'web/dist'),
  })

  const approvedThread = await postJson(`${pando.url}/api/threads`, { title: 'Approval approve smoke' })
  sse = await collectSse(`${pando.url}/api/events?threadId=${approvedThread.threadId}`)
  const approveChat = postJson(`${pando.url}/api/chat`, {
    threadId: approvedThread.threadId,
    prompt: 'please write approved file',
  })
  const approval = await waitForApproval(sse.events)
  await postJson(`${pando.url}/api/approval/${approval.data.approvalId}`, { decision: 'approve_once' })
  const approveResult = await approveChat
  assert(approveResult.ok === true, `approve chat should succeed: ${JSON.stringify(approveResult)}`)
  assert((await readFile(resolve(smokeRoot, 'approved-output.txt'), 'utf8')) === 'approved', 'approved tool should write file')
  await waitForAgentEvent(sse.events, 'approval_completed', event => event.approved === true, 'approval_completed should show approved')
  sse.close()

  const rejectedThread = await postJson(`${pando.url}/api/threads`, { title: 'Approval reject smoke' })
  sse = await collectSse(`${pando.url}/api/events?threadId=${rejectedThread.threadId}`)
  const rejectChat = postJson(`${pando.url}/api/chat`, {
    threadId: rejectedThread.threadId,
    prompt: 'please write rejected file',
  })
  const rejection = await waitForApproval(sse.events)
  await postJson(`${pando.url}/api/approval/${rejection.data.approvalId}`, { decision: 'reject' })
  const rejectResult = await rejectChat
  assert(rejectResult.ok === true, `reject chat should still complete: ${JSON.stringify(rejectResult)}`)
  await readFile(resolve(smokeRoot, 'rejected-output.txt'), 'utf8')
    .then(() => {
      throw new Error('rejected tool should not write file')
    })
    .catch(error => {
      if (error.message === 'rejected tool should not write file') throw error
    })
  await waitForAgentEvent(sse.events, 'approval_completed', event => event.approved === false, 'approval_completed should show rejection')
  sse.close()

  const gatewayThread = await postJson(`${pando.url}/api/threads`, { title: 'Approval gateway smoke' })
  sse = await collectSse(`${pando.url}/api/events?threadId=${gatewayThread.threadId}`)
  const gatewayChat = postJson(`${pando.url}/api/chat`, {
    threadId: gatewayThread.threadId,
    prompt: 'please write gateway file',
  })
  const gatewayApproval = await waitForApproval(sse.events)
  const gateway = new GatewayRuntime(new LocalGatewayStore(smokeRoot))
  const gatewayOutput = await gateway.start({
    sessionId: 'approval-web-gateway-smoke',
    config: fakeConfig(llm.url),
    durationMs: 160,
    heartbeatIntervalMs: 40,
    tickIntervalMs: 20,
    localMessages: [
      {
        channelId: 'local',
        userId: 'local-user',
        text: `/approve ${gatewayApproval.data.approvalId}`,
      },
    ],
  })
  assert(gatewayOutput.processedMessageCount === 1, 'gateway should process one approval command')
  const gatewayResult = await gatewayChat
  assert(gatewayResult.ok === true, `gateway-approved chat should succeed: ${JSON.stringify(gatewayResult)}`)
  assert((await readFile(resolve(smokeRoot, 'gateway-output.txt'), 'utf8')) === 'gateway', 'gateway approval should allow tool write')
  await waitForAgentEvent(sse.events, 'approval_completed', event => event.approved === true, 'gateway approval should complete approval')

  console.log('approval web smoke passed')
} finally {
  sse?.close()
  await pando?.close()
  await closeServer(llm)
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function fakeConfig(baseURL) {
  return {
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    providers: {
      'fake-openai-compatible': {
        baseURL,
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: { type: 'none' },
      },
    },
    permissions: {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'read-only',
    },
  }
}

function startFakeLlmServer() {
  let requestCount = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      requestCount += 1
      const parsed = JSON.parse(body || '{}')
      const messages = parsed.messages ?? []
      const latestUser = [...messages].reverse().find(message => message.role === 'user')?.content ?? ''
      const toolMessage = messages.find(message => message.role === 'tool')
      res.writeHead(200, { 'Content-Type': 'application/json' })

      if (!toolMessage && latestUser.includes('approved file')) {
        res.end(JSON.stringify(toolCallResponse('call_write_approved', 'approved-output.txt', 'approved')))
        return
      }
      if (!toolMessage && latestUser.includes('rejected file')) {
        res.end(JSON.stringify(toolCallResponse('call_write_rejected', 'rejected-output.txt', 'rejected')))
        return
      }
      if (!toolMessage && latestUser.includes('gateway file')) {
        res.end(JSON.stringify(toolCallResponse('call_write_gateway', 'gateway-output.txt', 'gateway')))
        return
      }
      const text = toolMessage?.content?.includes('Approval denied') ? 'rejection observed' : 'approval web ok'
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: text,
            },
          },
        ],
        usage: { total_tokens: requestCount },
      }))
    })
  })
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolveServer({
        url: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise(resolveClose => server.close(resolveClose)),
      })
    })
  })
}

function toolCallResponse(id, path, content) {
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
                name: 'file_write',
                arguments: JSON.stringify({ path, content }),
              },
            },
          ],
        },
      },
    ],
    usage: { total_tokens: 10 },
  }
}

async function collectSse(url) {
  const controller = new AbortController()
  const events = []
  let markReady
  const opened = new Promise(resolveOpen => {
    markReady = resolveOpen
  })
  const ready = (async () => {
    const response = await fetch(url, { signal: controller.signal })
    assert(response.ok, `SSE response should be ok: ${response.status}`)
    assert(response.body, 'SSE response should include a body')
    markReady()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const parsed = parseSseBlock(block)
        if (parsed) events.push(parsed)
      }
    }
  })().catch(error => {
    if (error.name !== 'AbortError') throw error
  })
  await opened
  return {
    events,
    close() {
      controller.abort()
      void ready
    },
  }
}

function parseSseBlock(block) {
  const event = block.match(/^event: (.+)$/m)?.[1] ?? 'message'
  const data = block.match(/^data: (.+)$/m)?.[1]
  if (!data) return undefined
  return { event, data: JSON.parse(data) }
}

async function waitForApproval(events) {
  const started = Date.now()
  while (Date.now() - started < 8000) {
    const approval = events.find(event => event.event === 'approval_pending')
    if (approval) return approval
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for approval_pending')
}

function hasAgentEvent(events, type, predicate = () => true) {
  return events.some(event => event.event === 'agent_event' && event.data?.type === type && predicate(event.data))
}

async function waitForAgentEvent(events, type, predicate, message) {
  const started = Date.now()
  while (Date.now() - started < 8000) {
    if (hasAgentEvent(events, type, predicate)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

async function closeServer(server) {
  if (server) await server.close()
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
