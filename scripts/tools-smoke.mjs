#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const { createDefaultToolRegistry } = await import('../dist/src/tools.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-tool-smoke')
assertInside(root, smokeRoot)

await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

const registry = createDefaultToolRegistry()
const context = {
  cwd: smokeRoot,
  sessionId: 'tools-smoke',
  permissionMode: 'default',
  permissions: {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
  },
}

try {
  assertHasTools([
    'file_read',
    'glob',
    'grep',
    'file_write',
    'apply_patch',
    'shell_command',
    'powershell_command',
    'gui_action',
    'get_goal',
    'create_goal',
    'update_goal',
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
  ])

  await runOk('file_write', {
    path: 'notes/sample.txt',
    content: 'alpha\nneedle\n',
  })

  const read = await runOk('file_read', {
    path: 'notes/sample.txt',
    maxLines: 1,
  })
  assert(read.content.includes('alpha'), 'file_read should return file content')

  const grep = await runOk('grep', {
    pattern: 'needle',
    regex: false,
    include: '**/*.txt',
  })
  assert(grep.content.includes('needle'), 'grep should find needle')

  await runOk('apply_patch', {
    path: 'notes/sample.txt',
    oldText: 'needle',
    newText: 'patched',
  })

  const glob = await runOk('glob', {
    pattern: '**/*.txt',
  })
  assert(glob.content.includes('notes/sample.txt'), 'glob should find sample file')

  const shell = await runOk('shell_command', {
    command: 'echo shell-ok',
    timeoutMs: 10_000,
  })
  assert(shell.content.includes('shell-ok'), 'shell command should return stdout')
  assert(shell.metadata?.code === 'process_completed', 'successful shell command should include process metadata')

  const powershell = await runOk('powershell_command', {
    command: "'ps-ok'",
    timeoutMs: 10_000,
  })
  assert(powershell.content.includes('ps-ok'), 'PowerShell command should return stdout')

  const failingShell = await runFail('shell_command', {
    command: 'node -e process.exitCode=7',
    timeoutMs: 10_000,
  })
  assertFailure(failingShell, 'process_exit_nonzero', 'process')
  assert(failingShell.metadata?.exitCode === 7, 'failing shell command should expose exit code')

  const patchMiss = await runFail('apply_patch', {
    path: 'notes/sample.txt',
    oldText: 'not-present',
    newText: 'nope',
  })
  assertFailure(patchMiss, 'patch_old_text_not_found', 'edit_conflict')

  const outsidePath = await runFail('file_read', {
    path: resolve(root, 'README.md'),
  })
  assertFailure(outsidePath, 'path_outside_workspace', 'path_safety')

  const unknown = await runFail('missing_tool', {})
  assertFailure(unknown, 'tool_not_found', 'tool')

  const toolSearch = await runOk('tool_search', {
    query: 'background task',
    limit: 5,
  })
  assert(toolSearch.content.includes('task_create'), 'tool_search should discover registered advanced tools')

  console.log('tools smoke passed')
  console.log(`tools: ${registry.names().join(', ')}`)
} finally {
  await rm(smokeRoot, { recursive: true, force: true })
}

async function runOk(name, input) {
  const results = []
  for await (const update of runTools([{ id: `call_${name}`, name, input }], registry, context)) {
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

function assertFailure(result, code, category) {
  assert(result.metadata?.type === 'tool_failure', `failure should have type=tool_failure: ${JSON.stringify(result.metadata)}`)
  assert(result.metadata?.code === code, `failure should have code=${code}: ${JSON.stringify(result.metadata)}`)
  assert(result.metadata?.category === category, `failure should have category=${category}: ${JSON.stringify(result.metadata)}`)
  assert(typeof result.metadata?.message === 'string' && result.metadata.message.length > 0, 'failure should have a message')
  assert(typeof result.metadata?.toolName === 'string' && result.metadata.toolName.length > 0, 'failure should have toolName')
}

function assertHasTools(names) {
  for (const name of names) {
    assert(registry.has(name), `default registry missing ${name}`)
  }
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
