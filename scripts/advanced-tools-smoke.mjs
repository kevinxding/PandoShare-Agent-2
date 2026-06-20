#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const { createDefaultToolRegistry, createToolRegistry } = await import('../dist/src/tools.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')
const { createListMcpResourcesTool } = await import('../dist/src/tools/ListMcpResourcesTool/index.js')
const { createReadMcpResourceTool } = await import('../dist/src/tools/ReadMcpResourceTool/index.js')
const { LocalAutomationQueue } = await import('../dist/src/services/automationQueue/index.js')
const { LocalQuestionStore } = await import('../dist/src/services/questions/index.js')

const root = process.cwd()
const suite = process.argv[2] ?? 'all'
const smokeRoot = resolve(root, `.tmp-advanced-tools-${suite}`)
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

const registry = createDefaultToolRegistry()
const events = []
const context = {
  cwd: smokeRoot,
  sessionId: `advanced-tools-${suite}`,
  threadId: 'thread_advanced_tools',
  permissionMode: 'default',
  permissions: {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
  },
  metadata: {
    goalId: 'goal_advanced_tools',
    loopId: 'loop_advanced_tools',
    taskId: 'task_context',
  },
  emitEvent(event) {
    events.push(event)
  },
}

try {
  if (suite === 'all' || suite === 'task') await smokeTaskTools()
  if (suite === 'all' || suite === 'web') await smokeWebTools()
  if (suite === 'all' || suite === 'lsp') await smokeLspTool()
  if (suite === 'all' || suite === 'skill') await smokeSkillTool()
  if (suite === 'all' || suite === 'mcp') await smokeMcpResourceTools()
  if (suite === 'all' || suite === 'ask') await smokeAskUserTool()
  if (suite === 'all' || suite === 'schedule') await smokeScheduleTools()
  if (suite === 'all' || suite === 'notebook') await smokeNotebookTool()
  if (suite === 'all' || suite === 'permissions') await smokeToolPermissions()
  if (suite === 'all' || suite === 'events') await smokeToolEvents()
  if (suite === 'all' || suite === 'registry') await smokeRegistry()
  console.log(`advanced tools smoke passed: ${suite}`)
} finally {
  await rm(smokeRoot, { recursive: true, force: true })
}

async function smokeTaskTools() {
  const created = await runOk('task_create', {
    taskId: 'task_smoke',
    title: 'Task smoke',
    command: 'echo task-ok',
  })
  assert(JSON.parse(created.content).taskId === 'task_smoke', 'task_create should return task metadata')
  await waitForTaskStatus('task_smoke', ['completed', 'failed'])
  const output = await runOk('task_output', { taskId: 'task_smoke' })
  assert(output.content.includes('task-ok'), 'task_output should include command output')
  const listed = await runOk('task_list', { limit: 10 })
  assert(listed.content.includes('task_smoke'), 'task_list should include created task')
  const updated = await runOk('task_update', { taskId: 'task_smoke', summary: 'reviewed' })
  assert(updated.content.includes('reviewed'), 'task_update should persist summary')
  const slow = await runOk('task_create', {
    taskId: 'task_stop_smoke',
    command: 'ping 127.0.0.1 -n 6 > nul',
  })
  assert(slow.content.includes('task_stop_smoke'), 'task_create should start a stoppable task')
  const stopped = await runOk('task_stop', { taskId: 'task_stop_smoke', reason: 'smoke stop' })
  assert(JSON.parse(stopped.content).status === 'stopped', 'task_stop should mark task stopped')
}

async function smokeWebTools() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end(`fetch-ok ${request.url}`)
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  try {
    const address = server.address()
    assert(address && typeof address === 'object', 'local fetch server should expose port')
    const fetched = await runOk('web_fetch', { url: `http://127.0.0.1:${address.port}/hello`, maxChars: 20 })
    assert(fetched.content.includes('fetch-ok'), 'web_fetch should fetch local HTTP content')
    process.env.PANDO_WEB_SEARCH_FIXTURES = JSON.stringify([
      { title: 'Pando Agent', url: 'https://example.test/pando', snippet: 'Pando tool search result' },
    ])
    const searched = await runOk('web_search', { query: 'pando', maxResults: 3 })
    assert(searched.content.includes('https://example.test/pando'), 'web_search should return fixture citation')
    delete process.env.PANDO_WEB_SEARCH_FIXTURES
    const failed = await runFail('web_fetch', { url: 'file:///tmp/nope' })
    assert(failed.metadata.code === 'invalid_input', 'web_fetch should reject non-http URLs')
  } finally {
    server.close()
  }
}

async function smokeLspTool() {
  await mkdir(resolve(smokeRoot, 'src'), { recursive: true })
  await writeFile(resolve(smokeRoot, 'src/sample.ts'), 'export function alpha() { return 1 }\nconst beta = alpha()\n', 'utf8')
  const symbols = await runOk('lsp', { action: 'symbols', path: 'src', maxResults: 10 })
  assert(symbols.content.includes('alpha'), 'lsp symbols should find function names')
  const definition = await runOk('lsp', { action: 'definition', path: 'src', symbol: 'alpha', maxResults: 10 })
  assert(definition.content.includes('definition'), 'lsp definition should classify definition lines')
  const missing = await runFail('lsp', { action: 'definition', path: 'src' })
  assert(missing.metadata.code === 'invalid_input', 'lsp missing symbol should fail structurally')
}

async function smokeSkillTool() {
  await mkdir(resolve(smokeRoot, '.pandoshare/skills/sample'), { recursive: true })
  await writeFile(resolve(smokeRoot, '.pandoshare/skills/sample/SKILL.md'), '# Sample Skill\nUse carefully.\n', 'utf8')
  const list = await runOk('skill', { action: 'list' })
  assert(list.content.includes('sample'), 'skill list should discover workspace skill')
  const load = await runOk('skill', { action: 'load', skillId: 'sample' })
  assert(load.content.includes('Sample Skill'), 'skill load should read SKILL.md')
  const missing = await runFail('skill', { action: 'load', skillId: 'missing' })
  assert(missing.metadata.code === 'not_found' || missing.metadata.code === 'tool_exception', 'skill missing should fail structurally')
}

async function smokeMcpResourceTools() {
  const fakeConnection = {
    serverName: 'fake',
    status: 'connected',
    tools: [],
    resources: [{ uri: 'pando://resource/one', name: 'one', mimeType: 'text/plain' }],
    client: {
      async callTool() {
        return {}
      },
      async readResource(uri) {
        return { contents: [{ uri, text: 'resource-ok' }] }
      },
      close() {},
    },
  }
  const mcpRegistry = createToolRegistry([
    createListMcpResourcesTool(() => [fakeConnection]),
    createReadMcpResourceTool(() => [fakeConnection]),
  ])
  const list = await runOkWithRegistry(mcpRegistry, 'list_mcp_resources', {})
  assert(list.content.includes('pando://resource/one'), 'list_mcp_resources should list fake resource')
  const read = await runOkWithRegistry(mcpRegistry, 'read_mcp_resource', { serverName: 'fake', uri: 'pando://resource/one' })
  assert(read.content.includes('resource-ok'), 'read_mcp_resource should read fake resource')
}

async function smokeAskUserTool() {
  const question = await runOk('ask_user_question', {
    question: 'Continue?',
    mode: 'non_blocking',
    autoResolutionMs: 1000,
    defaultAnswer: 'yes',
  })
  assert(question.content.includes('question_'), 'ask_user_question should create a question record')
  const file = await readFile(resolve(smokeRoot, '.pandoshare/questions/questions.jsonl'), 'utf8')
  assert(file.includes('Continue?'), 'ask_user_question should persist question ledger')
  const created = JSON.parse(question.content)
  const store = new LocalQuestionStore(smokeRoot)
  const answered = await store.answerQuestion(created.questionId, 'manual yes', 'smoke')
  assert(answered.status === 'answered' && answered.answer === 'manual yes', 'question store should answer questions')
  const auto = await store.createQuestion({
    questionId: 'question_auto_smoke',
    question: 'Auto?',
    mode: 'non_blocking',
    autoResolutionMs: 1,
    defaultAnswer: 'auto yes',
    sessionId: 'ask-smoke',
  })
  assert(auto.status === 'queued', 'non-blocking question should start queued')
  await delay(5)
  const autoResolved = await store.readQuestion('question_auto_smoke')
  assert(autoResolved.status === 'answered' && autoResolved.answeredBy === 'auto_resolution', 'question store should auto-resolve defaults')
}

async function smokeScheduleTools() {
  const schedule = await runOk('schedule_cron', { schedule: '*/5 * * * *', command: 'goal resume' })
  assert(schedule.content.includes('schedule_'), 'schedule_cron should persist schedule')
  const trigger = await runOk('remote_trigger', { channel: 'mock', payload: '/goal status' })
  assert(trigger.content.includes('trigger_'), 'remote_trigger should persist trigger')
  const message = await runOk('send_message', { channel: 'mock', text: 'hello' })
  assert(message.content.includes('message_'), 'send_message should persist outbound message')
  const queue = new LocalAutomationQueue(smokeRoot)
  const snapshot = await queue.readSnapshot()
  assert(snapshot.schedules.length === 1, `expected one schedule, got ${snapshot.schedules.length}`)
  assert(snapshot.schedules[0].command === '/goal resume', 'schedule command should be normalized for Gateway')
  assert(snapshot.schedules[0].goalId === 'goal_advanced_tools', 'schedule should link goalId from tool metadata')
  assert(snapshot.triggers.length === 1, `expected one trigger, got ${snapshot.triggers.length}`)
  assert(snapshot.triggers[0].payload === '/goal status', 'trigger payload should be normalized for Gateway')
  assert(snapshot.messages.length === 1, `expected one queued message, got ${snapshot.messages.length}`)
  assert(snapshot.messages[0].status === 'queued', 'send_message should queue messages for Gateway delivery')
}

async function smokeNotebookTool() {
  const notebook = {
    cells: [],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  }
  await writeFile(resolve(smokeRoot, 'sample.ipynb'), `${JSON.stringify(notebook, null, 2)}\n`, 'utf8')
  const edited = await runOk('notebook_edit', {
    path: 'sample.ipynb',
    action: 'insert',
    index: 0,
    cellType: 'markdown',
    source: '# hello',
  })
  assert(edited.content.includes('"cellCount": 1'), 'notebook_edit should insert a cell')
}

async function smokeToolPermissions() {
  const readOnlyContext = {
    ...context,
    permissions: {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'read-only',
    },
  }
  const results = []
  for await (const update of runTools([{ id: 'permission_task_create', name: 'task_create', input: { taskId: 'denied', command: 'echo no' } }], registry, readOnlyContext)) {
    results.push(update.result)
  }
  assert(results.length === 1 && !results[0].ok, 'external task_create should be denied in read-only sandbox')
  assert(results[0].metadata?.code === 'sandbox_denied', 'permission denial should be structured')
}

async function smokeToolEvents() {
  const before = events.length
  await runOk('tool_search', { query: 'task', limit: 3 })
  const emitted = events.slice(before)
  assert(emitted.some(event => event.type === 'tool_call_started'), 'tool should emit started event')
  assert(emitted.some(event => event.type === 'tool_call_completed'), 'tool should emit completed event')
  const completed = emitted.find(event => event.type === 'tool_call_completed')
  assert(completed?.goalId === 'goal_advanced_tools', 'tool events should include goalId')
  assert(completed?.threadId === 'thread_advanced_tools', 'tool events should include threadId')
  assert(completed?.loopId === 'loop_advanced_tools', 'tool events should include loopId')
  assert(completed?.taskId === 'task_context', 'tool events should include taskId')
}

async function smokeRegistry() {
  const required = [
    'todo_write',
    'task_create',
    'task_list',
    'task_get',
    'task_update',
    'task_output',
    'task_stop',
    'web_fetch',
    'web_search',
    'lsp',
    'skill',
    'repl',
    'list_mcp_resources',
    'read_mcp_resource',
    'ask_user_question',
    'notebook_edit',
    'schedule_cron',
    'remote_trigger',
    'send_message',
    'tool_search',
  ]
  for (const name of required) {
    assert(registry.has(name), `default registry missing ${name}`)
    const tool = registry.get(name)
    assert(tool?.inputSchema && tool.safety && tool.description, `${name} should declare schema, safety, and description`)
  }
  const todo = await runOk('todo_write', {
    todos: [
      { content: 'one', status: 'completed' },
      { content: 'two', status: 'in_progress' },
    ],
  })
  assert(todo.content.includes('todos'), 'todo_write should persist todos')
  const replOne = await runOk('repl', { sessionName: 'smoke', code: 'var x = 41; x + 1' })
  assert(replOne.content.includes('42'), 'repl should execute JavaScript')
  const replTwo = await runOk('repl', { sessionName: 'smoke', code: 'x += 1; x' })
  assert(replTwo.content.includes('42'), 'repl should retain session state')
  const search = await runOk('tool_search', { query: 'background task', limit: 5 })
  assert(search.content.includes('task_create'), 'tool_search should discover task tools')
}

async function waitForTaskStatus(taskId, statuses) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const task = JSON.parse((await runOk('task_get', { taskId })).content)
    if (statuses.includes(task.status)) return task
    await delay(100)
  }
  throw new Error(`Timed out waiting for task ${taskId} status ${statuses.join(', ')}`)
}

async function runOk(name, input) {
  return runOkWithRegistry(registry, name, input)
}

async function runOkWithRegistry(targetRegistry, name, input) {
  const results = []
  for await (const update of runTools([{ id: `call_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input }], targetRegistry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `${name} should return one result`)
  const result = results[0]
  assert(result.ok, `${name} failed: ${result.content}`)
  return result
}

async function runFail(name, input) {
  const results = []
  for await (const update of runTools([{ id: `call_${name}_fail`, name, input }], registry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `${name} should return one result`)
  const result = results[0]
  assert(!result.ok, `${name} should fail`)
  return result
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertInside(base, target) {
  const relativePath = relative(resolve(base), resolve(target))
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Refusing to use smoke path outside workspace: ${target}`)
  }
}
