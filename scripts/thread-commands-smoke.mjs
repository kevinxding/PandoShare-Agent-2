#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

const { LocalThreadStore } = await import('../dist/src/services/threadStore/index.js')

const root = process.cwd()
const mainPath = resolve(root, 'dist/src/main.js')
const smokeRoot = resolve(root, '.tmp-thread-commands-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const store = new LocalThreadStore(smokeRoot)
  const alpha = await createFixtureThread(store, smokeRoot, {
    threadId: 'thread_alpha',
    sessionId: 'session-alpha',
    title: 'alpha thread',
    prompt: 'hello alpha',
    answer: 'world alpha',
    finalText: 'final alpha',
  })
  await delay(5)
  const beta = await createFixtureThread(store, smokeRoot, {
    threadId: 'thread_beta',
    sessionId: 'session-beta',
    title: 'beta thread',
    prompt: 'hello beta',
    answer: 'world beta',
    finalText: 'final beta',
  })

  const listOutput = runCli(['thread', 'list'], smokeRoot)
  assertIncludes(listOutput, alpha.metadata.threadId, 'list should include alpha')
  assertIncludes(listOutput, beta.metadata.threadId, 'list should include beta')
  assert(
    listOutput.indexOf(beta.metadata.threadId) < listOutput.indexOf(alpha.metadata.threadId),
    'list should sort by updated time descending',
  )

  const limitOutput = runCli(['thread', 'list', '--limit', '1'], smokeRoot)
  assertIncludes(limitOutput, beta.metadata.threadId, 'limited list should include newest thread')
  assert(!limitOutput.includes(alpha.metadata.threadId), 'limited list should omit older thread')

  const renameOutput = runCli(['thread', 'rename', alpha.metadata.threadId, 'renamed alpha'], smokeRoot)
  assertIncludes(renameOutput, 'Renamed thread: thread_alpha', 'rename output should name thread')
  assert((await store.readMetadata(alpha.metadata.threadId)).title === 'renamed alpha', 'rename should update metadata')

  const inspectOutput = runCli(['thread', 'inspect', alpha.metadata.threadId], smokeRoot)
  assertIncludes(inspectOutput, 'Title: renamed alpha', 'inspect should show renamed title')
  assertIncludes(inspectOutput, 'Messages: 2', 'inspect should show message count')
  assertIncludes(inspectOutput, 'Events: 1', 'inspect should show event count')
  assertIncludes(inspectOutput, 'Checkpoints: 1', 'inspect should show checkpoint count')
  assertIncludes(inspectOutput, 'Last checkpoint preview: final alpha', 'inspect should show checkpoint preview')

  const jsonOutput = runCli(['thread', 'export', alpha.metadata.threadId, '--format', 'json'], smokeRoot)
  const jsonExport = JSON.parse(jsonOutput)
  assert(jsonExport.metadata.threadId === alpha.metadata.threadId, 'json export should include metadata')
  assert(jsonExport.messages.length === 2, 'json export should include messages')
  assert(jsonExport.events.length === 1, 'json export should include events')
  assert(jsonExport.checkpoints.length === 1, 'json export should include checkpoints')

  const markdownOutput = runCli(['thread', 'export', alpha.metadata.threadId], smokeRoot)
  assertIncludes(markdownOutput, '# renamed alpha', 'markdown export should include title')
  assertIncludes(markdownOutput, 'hello alpha', 'markdown export should include user message')
  assertIncludes(markdownOutput, 'world alpha', 'markdown export should include assistant message')
  assertIncludes(markdownOutput, '## Checkpoints', 'markdown export should include checkpoint section')

  const outOutput = runCli(['thread', 'export', alpha.metadata.threadId, '--out', 'alpha-export.md'], smokeRoot)
  assertIncludes(outOutput, 'Exported thread: thread_alpha', 'export --out should report success')
  const outText = await readFile(resolve(smokeRoot, 'alpha-export.md'), 'utf8')
  assertIncludes(outText, '# renamed alpha', 'export --out should write markdown')

  const branchOutput = runCli(['thread', 'branch', alpha.metadata.threadId, '--title', 'alpha branch'], smokeRoot)
  const branchId = matchRequired(branchOutput, /Created branch thread: (\S+)/, 'branch output should include id')
  const branchMetadata = await store.readMetadata(branchId)
  const branchMessages = await store.readMessages(branchId)
  const branchEvents = await store.readEvents(branchId)
  const branchCheckpoints = await store.readCheckpoints(branchId)
  assert(branchMetadata.parentThreadId === alpha.metadata.threadId, 'branch should record parentThreadId')
  assert(branchMetadata.title === 'alpha branch', 'branch should use requested title')
  assert(branchMessages.length === 2, 'branch should copy parent messages')
  assert(branchEvents.length === 0, 'branch should start with empty events')
  assert(branchCheckpoints.length === 0, 'branch should start with empty checkpoints')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('thread commands smoke passed')

async function createFixtureThread(store, workspaceRoot, input) {
  const record = await store.createThread({
    threadId: input.threadId,
    sessionId: input.sessionId,
    title: input.title,
    cwd: workspaceRoot,
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
  })
  await store.writeMessages(input.threadId, [
    {
      role: 'user',
      content: input.prompt,
    },
    {
      role: 'assistant',
      content: input.answer,
    },
  ])
  await store.appendEvent(input.threadId, {
    id: `event-${input.threadId}`,
    type: 'turn_completed',
    sessionId: input.sessionId,
    turnId: `turn-${input.threadId}`,
    createdAtMs: Date.now(),
    ok: true,
    finalTextPreview: input.finalText,
    rounds: 1,
    durationMs: 1,
  })
  await store.appendCheckpoint(
    input.threadId,
    store.createCheckpoint({
      metadata: record.metadata,
      turnId: `turn-${input.threadId}`,
      messageCount: 2,
      eventCount: 1,
      finalText: input.finalText,
    }),
  )
  return {
    ...record,
    metadata: await store.readMetadata(input.threadId),
  }
}

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [mainPath, ...args], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `CLI failed: node ${mainPath} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result.stdout
}

function assertIncludes(text, expected, message) {
  assert(text.includes(expected), `${message}\nmissing: ${expected}\nactual:\n${text}`)
}

function matchRequired(text, pattern, message) {
  const match = text.match(pattern)
  assert(match?.[1], `${message}\nactual:\n${text}`)
  return match[1]
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
  }
}

function delay(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
