#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

const { LocalLoopStore, LoopRuntime } = await import('../dist/src/services/loopRuntime/index.js')
const { LocalGoalStore } = await import('../dist/src/services/goalStore/index.js')
const { createDefaultToolRegistry } = await import('../dist/src/tools.js')

const root = process.cwd()
const mainPath = resolve(root, 'dist/src/main.js')
const smokeRoot = resolve(root, '.tmp-loop-runtime-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeRuntimeClosure(smokeRoot)
  await smokeGoalLinkedLoop(smokeRoot)
  await smokeTempCopyIsolation(smokeRoot)
  await smokeGuiToolLoop(smokeRoot)
  await smokeConsecutiveFailurePolicy(smokeRoot)
  await smokeTokenFailurePolicy(smokeRoot)
  await smokeManualInterventionPolicy(smokeRoot)
  await smokeCliCommands(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('loop runtime smoke passed')

async function smokeGoalLinkedLoop(workspaceRoot) {
  const goalStore = new LocalGoalStore(workspaceRoot)
  await goalStore.createGoal({
    goalId: 'goal_loop_smoke',
    sessionId: 'goal-loop-create',
    cwd: workspaceRoot,
    objective: 'Record loop progress and evidence.',
    requirements: ['Loop evidence should be recorded'],
  })
  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_goal_smoke',
      goalId: 'goal_loop_smoke',
      title: 'Loop goal smoke',
      objective: 'Finish immediately.',
      verification: [
        {
          type: 'command',
          command: 'node -e "process.exit(0)"',
          timeoutMs: 5000,
        },
      ],
      failurePolicy: {
        maxIterations: 1,
      },
    },
    {
      sessionId: 'loop-goal-create',
      cwd: workspaceRoot,
    },
  )
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-goal-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 1,
    fetch: async () => jsonResponse(textResponse('No code changes needed.')),
  })
  assert(output.metadata.status === 'completed', `expected goal-linked loop completed, got ${output.metadata.status}`)
  const goal = await goalStore.readExport('goal_loop_smoke')
  assert(goal.runs.some(run => run.loopId === 'loop_goal_smoke' && run.status === 'completed'), 'goal should record completed loop run')
  assert(goal.evidence.some(evidence => evidence.type === 'loop' && evidence.loopId === 'loop_goal_smoke'), 'goal should record loop evidence')
  assert(goal.progress.some(progress => progress.message.includes('loop_goal_smoke')), 'goal should record loop progress')
}

async function smokeRuntimeClosure(workspaceRoot) {
  await writeFile(
    resolve(workspaceRoot, 'verify.mjs'),
    "import { readFileSync } from 'node:fs'; const text = readFileSync('answer.txt','utf8'); if (text.trim() !== 'fixed') { console.error(`expected fixed, got ${text.trim()}`); process.exit(1); } console.log('verified fixed');\n",
    'utf8',
  )

  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_runtime_smoke',
      title: 'Loop runtime smoke',
      objective: 'Create answer.txt with the exact text fixed.',
      successCriteria: 'answer.txt must contain fixed.',
      verification: [
        {
          type: 'command',
          command: 'node verify.mjs',
          timeoutMs: 5000,
        },
      ],
      failurePolicy: {
        maxIterations: 2,
      },
    },
    {
      sessionId: 'loop-smoke-create',
      cwd: workspaceRoot,
    },
  )

  let requestCount = 0
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-smoke-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 2,
    fetch: async (_url, init) => {
      requestCount += 1
      JSON.parse(String(init.body ?? '{}'))
      if (requestCount === 1) {
        return jsonResponse(toolCallResponse('call_write_wrong', 'file_write', {
          path: 'answer.txt',
          content: 'wrong',
        }))
      }
      if (requestCount === 2) {
        return jsonResponse(textResponse('I wrote the first version.'))
      }
      if (requestCount === 3) {
        return jsonResponse(toolCallResponse('call_write_fixed', 'file_write', {
          path: 'answer.txt',
          content: 'fixed',
        }))
      }
      if (requestCount === 4) {
        return jsonResponse(textResponse('I fixed answer.txt.'))
      }
      throw new Error(`unexpected request count: ${requestCount}`)
    },
  })

  assert(output.metadata.status === 'completed', `expected loop completed, got ${output.metadata.status}`)
  assert(output.iterations.length === 2, `expected 2 iterations, got ${output.iterations.length}`)
  assert(output.iterations[0].status === 'failed', 'first iteration should fail verification')
  assert(output.iterations[1].status === 'completed', 'second iteration should pass verification')
  assert(output.metadata.threadId, 'loop should keep the QueryEngine thread id')
  assert((await readFile(resolve(workspaceRoot, 'answer.txt'), 'utf8')).trim() === 'fixed', 'answer.txt should be fixed')

  const loopPath = resolve(workspaceRoot, '.pandoshare/loops/loop_runtime_smoke')
  for (const file of ['metadata.json', 'state.md', 'runs.jsonl', 'iterations.jsonl', 'events.jsonl']) {
    await readFile(resolve(loopPath, file), 'utf8')
  }

  const summary = await store.readSummary(metadata.loopId)
  assert(summary.runCount === 1, `expected 1 run, got ${summary.runCount}`)
  assert(summary.iterationCount === 2, `expected 2 stored iterations, got ${summary.iterationCount}`)
  assert(summary.lastRun?.status === 'completed', 'last run should be completed')
}

async function smokeTempCopyIsolation(workspaceRoot) {
  const sourceRoot = resolve(workspaceRoot, 'source-project')
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(resolve(sourceRoot, 'seed.txt'), 'source seed\n', 'utf8')

  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_temp_copy_smoke',
      title: 'Loop temp copy smoke',
      objective: 'Write isolated-output.txt with the exact text isolated.',
      successCriteria: 'isolated-output.txt must exist only in the isolated loop workspace.',
      workspaceIsolation: 'temp_copy',
      verification: [
        {
          type: 'file',
          path: 'isolated-output.txt',
          exists: true,
          contains: 'isolated',
        },
      ],
      failurePolicy: {
        maxIterations: 1,
      },
    },
    {
      sessionId: 'loop-temp-copy-create',
      cwd: sourceRoot,
    },
  )

  let requestCount = 0
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-temp-copy-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 2,
    fetch: async (_url, init) => {
      requestCount += 1
      JSON.parse(String(init.body ?? '{}'))
      if (requestCount === 1) {
        return jsonResponse(toolCallResponse('call_write_isolated', 'file_write', {
          path: 'isolated-output.txt',
          content: 'isolated',
        }))
      }
      if (requestCount === 2) {
        return jsonResponse(textResponse('I wrote isolated-output.txt.'))
      }
      throw new Error(`unexpected temp copy request count: ${requestCount}`)
    },
  })

  assert(output.metadata.status === 'completed', `expected temp copy loop completed, got ${output.metadata.status}`)
  const summary = await store.readSummary(metadata.loopId)
  const workspaceCwd = summary.lastRun?.workspaceCwd
  assert(summary.lastRun?.workspaceIsolation === 'temp_copy', 'last run should record temp_copy isolation')
  assert(typeof workspaceCwd === 'string' && workspaceCwd.includes('workspaces'), 'last run should record isolated workspace path')
  assert((await readFile(resolve(workspaceCwd, 'seed.txt'), 'utf8')).trim() === 'source seed', 'temp copy should copy source files')
  assert((await readFile(resolve(workspaceCwd, 'isolated-output.txt'), 'utf8')).trim() === 'isolated', 'isolated workspace should contain output')
  assert(!(await pathExists(resolve(sourceRoot, 'isolated-output.txt'))), 'source workspace should not be polluted by temp copy output')
  assert(summary.lastIteration?.workspaceCwd === workspaceCwd, 'iteration should record isolated workspace path')
  const events = await store.readEvents(metadata.loopId)
  assert(events.some(event => event.type === 'loop_workspace_prepared'), 'loop should record workspace preparation event')
}

async function smokeGuiToolLoop(workspaceRoot) {
  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_gui_tool_smoke',
      title: 'Loop GUI tool smoke',
      objective: 'Run a Pando GUI action from inside the loop runtime.',
      successCriteria: 'The loop must call gui_action and complete after GUI verification.',
      verification: [
        {
          type: 'command',
          command: 'node -e "process.exit(0)"',
          timeoutMs: 5000,
        },
      ],
      failurePolicy: {
        maxIterations: 1,
      },
    },
    {
      sessionId: 'loop-gui-tool-create',
      cwd: workspaceRoot,
    },
  )

  let requestCount = 0
  let guiActionCount = 0
  let screenshotCount = 0
  const events = []
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-gui-tool-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 2,
    metadata: {
      guiBackend: {
        uiaAction: async request => {
          guiActionCount += 1
          assert(request.action === 'wait', `expected GUI wait action, got ${request.action}`)
          return {
            ok: true,
            method: 'uia',
            message: 'fake loop GUI wait completed',
            screenshotPath: '.tmp/fake-loop-gui-action.png',
          }
        },
        screenshot: async () => {
          screenshotCount += 1
          return {
            ok: true,
            method: 'uia',
            message: 'fake loop GUI verification completed',
            screenshotPath: '.tmp/fake-loop-gui-verified.png',
          }
        },
      },
    },
    onEvent(event) {
      events.push(event)
    },
    fetch: async (_url, init) => {
      requestCount += 1
      JSON.parse(String(init.body ?? '{}'))
      if (requestCount === 1) {
        return jsonResponse(toolCallResponse('call_gui_wait', 'gui_action', {
          action: 'wait',
          timeoutMs: 1,
          verify: true,
        }))
      }
      if (requestCount === 2) {
        return jsonResponse(textResponse('GUI action completed and verified.'))
      }
      throw new Error(`unexpected GUI loop request count: ${requestCount}`)
    },
  })

  assert(output.metadata.status === 'completed', `expected GUI loop completed, got ${output.metadata.status}`)
  assert(output.iterations.length === 1, `expected one GUI loop iteration, got ${output.iterations.length}`)
  assert(guiActionCount === 1, `expected one GUI backend action, got ${guiActionCount}`)
  assert(screenshotCount === 1, `expected one GUI verification screenshot, got ${screenshotCount}`)
  assert(events.some(event => event.type === 'gui_action_started'), 'loop should emit gui_action_started')
  assert(events.some(event => event.type === 'gui_action_verified' && event.ok === true), 'loop should emit successful gui_action_verified')
  assert(events.some(event => event.type === 'gui_action_completed' && event.ok === true), 'loop should emit successful gui_action_completed')
  assert(output.iterations[0].finalTextPreview.includes('GUI action completed'), 'loop final text should include GUI completion')
}

async function smokeConsecutiveFailurePolicy(workspaceRoot) {
  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_failure_policy_smoke',
      title: 'Loop failure policy smoke',
      objective: 'Do not create never-created.txt.',
      successCriteria: 'This loop intentionally keeps failing verification.',
      verification: [
        {
          type: 'file',
          path: 'never-created.txt',
          exists: true,
        },
      ],
      failurePolicy: {
        maxIterations: 5,
        maxConsecutiveFailures: 2,
      },
    },
    {
      sessionId: 'loop-failure-policy-create',
      cwd: workspaceRoot,
    },
  )

  let requestCount = 0
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-failure-policy-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 1,
    fetch: async (_url, init) => {
      requestCount += 1
      JSON.parse(String(init.body ?? '{}'))
      return jsonResponse(textResponse(`attempt ${requestCount} did not satisfy the verifier`))
    },
  })

  assert(output.metadata.status === 'blocked', `expected failure-policy loop blocked, got ${output.metadata.status}`)
  assert(output.iterations.length === 2, `expected maxConsecutiveFailures to stop at 2 iterations, got ${output.iterations.length}`)
  assert(requestCount === 2, `expected 2 model requests, got ${requestCount}`)
  assert(output.run.finalMessage?.includes('maxConsecutiveFailures=2'), 'final run message should mention maxConsecutiveFailures')
  const events = await store.readEvents(metadata.loopId)
  assert(events.some(event => event.type === 'loop_failure_policy_triggered'), 'loop should record failure-policy event')
  const state = await store.readState(metadata.loopId)
  assertIncludes(state, 'maxConsecutiveFailures=2', 'loop state should explain failure-policy block')
}

async function smokeTokenFailurePolicy(workspaceRoot) {
  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_token_policy_smoke',
      title: 'Loop token policy smoke',
      objective: 'Keep running until token policy stops the loop.',
      successCriteria: 'This loop intentionally exceeds its token budget.',
      verification: [
        {
          type: 'file',
          path: 'token-budget-output.txt',
          exists: true,
        },
      ],
      failurePolicy: {
        maxIterations: 5,
        maxConsecutiveFailures: 5,
        maxTokens: 5,
      },
    },
    {
      sessionId: 'loop-token-policy-create',
      cwd: workspaceRoot,
    },
  )

  let requestCount = 0
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-token-policy-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 1,
    fetch: async (_url, init) => {
      requestCount += 1
      JSON.parse(String(init.body ?? '{}'))
      return jsonResponse(textResponse('token budget attempt', { total_tokens: 7 }))
    },
  })

  assert(output.metadata.status === 'blocked', `expected token-policy loop blocked, got ${output.metadata.status}`)
  assert(output.iterations.length === 1, `expected maxTokens to stop at 1 iteration, got ${output.iterations.length}`)
  assert(output.iterations[0].usageTokens === 7, `expected iteration usageTokens=7, got ${output.iterations[0].usageTokens}`)
  assert(output.run.usedTokens === 7, `expected run usedTokens=7, got ${output.run.usedTokens}`)
  assert(output.run.finalMessage?.includes('maxTokens=5'), 'final run message should mention maxTokens')
  assert(requestCount === 1, `expected 1 model request, got ${requestCount}`)
  const events = await store.readEvents(metadata.loopId)
  assert(events.some(event => event.type === 'loop_failure_policy_triggered' && event.data?.policy === 'maxTokens'), 'loop should record token failure-policy event')
  const state = await store.readState(metadata.loopId)
  assertIncludes(state, 'maxTokens=5', 'loop state should explain token-policy block')
}

async function smokeManualInterventionPolicy(workspaceRoot) {
  const store = new LocalLoopStore(workspaceRoot)
  const metadata = await store.createLoop(
    {
      loopId: 'loop_manual_intervention_smoke',
      title: 'Loop manual intervention smoke',
      objective: 'Keep failing until manual intervention is required.',
      successCriteria: 'This loop intentionally needs human review after verifier failure.',
      verification: [
        {
          type: 'file',
          path: 'manual-intervention-output.txt',
          exists: true,
        },
      ],
      failurePolicy: {
        maxIterations: 5,
        maxConsecutiveFailures: 5,
        manualIntervention: {
          afterConsecutiveFailures: 1,
        },
      },
    },
    {
      sessionId: 'loop-manual-intervention-create',
      cwd: workspaceRoot,
    },
  )

  let requestCount = 0
  const runtime = new LoopRuntime(store)
  const output = await runtime.runLoop(metadata.loopId, {
    sessionId: 'loop-manual-intervention-run',
    config: fakeConfig(),
    registry: createDefaultToolRegistry(),
    maxToolRounds: 1,
    fetch: async (_url, init) => {
      requestCount += 1
      JSON.parse(String(init.body ?? '{}'))
      return jsonResponse(textResponse('manual review needed'))
    },
  })

  assert(output.metadata.status === 'blocked', `expected manual-intervention loop blocked, got ${output.metadata.status}`)
  assert(output.iterations.length === 1, `expected manual intervention to stop at 1 iteration, got ${output.iterations.length}`)
  assert(requestCount === 1, `expected 1 model request, got ${requestCount}`)
  assert(output.run.finalMessage?.includes('manual intervention'), 'final run message should mention manual intervention')
  const events = await store.readEvents(metadata.loopId)
  const intervention = events.find(event => event.type === 'loop_manual_intervention_required')
  assert(intervention?.data?.reason === 'afterConsecutiveFailures', 'loop should record manual intervention reason')
  const state = await store.readState(metadata.loopId)
  assertIncludes(state, 'manual intervention', 'loop state should explain manual intervention block')
}

async function smokeCliCommands(workspaceRoot) {
  const specPath = resolve(workspaceRoot, 'loop-spec.json')
  await writeFile(
    specPath,
    JSON.stringify(
      {
        loopId: 'loop_cli_smoke',
        title: 'Loop CLI smoke',
        objective: 'CLI loop fixture.',
        verification: [
          {
            type: 'file',
            path: 'missing.txt',
            exists: false,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )

  const createOutput = runCli(['loop', 'create', '--spec', 'loop-spec.json', '--workspace-isolation', 'temp_copy', '--trigger', 'heartbeat', '--max-tokens', '100', '--manual-intervention-after-failures', '2', '--manual-intervention-pattern', 'human review'], workspaceRoot)
  assertIncludes(createOutput, 'Created loop: loop_cli_smoke', 'loop create should report id')

  const listOutput = runCli(['loop', 'list'], workspaceRoot)
  assertIncludes(listOutput, 'loop_cli_smoke', 'loop list should include fixture')

  const inspectOutput = runCli(['loop', 'inspect', 'loop_cli_smoke'], workspaceRoot)
  assertIncludes(inspectOutput, 'Status: created', 'loop inspect should show status')
  assertIncludes(inspectOutput, 'Trigger: heartbeat', 'loop inspect should show trigger')
  assertIncludes(inspectOutput, 'Workspace: temp_copy', 'loop inspect should show workspace isolation')
  assertIncludes(inspectOutput, 'Objective: CLI loop fixture.', 'loop inspect should show objective')

  const pauseOutput = runCli(['loop', 'pause', 'loop_cli_smoke'], workspaceRoot)
  assertIncludes(pauseOutput, 'Paused loop: loop_cli_smoke', 'loop pause should report success')

  const exportOutput = runCli(['loop', 'export', 'loop_cli_smoke', '--format', 'json'], workspaceRoot)
  const exported = JSON.parse(exportOutput)
  assert(exported.metadata.loopId === 'loop_cli_smoke', 'json export should include metadata')
  assert(exported.metadata.trigger === 'heartbeat', 'json export should include trigger')
  assert(exported.metadata.spec.failurePolicy.maxTokens === 100, 'json export should include maxTokens failure policy')
  assert(exported.metadata.spec.failurePolicy.manualIntervention.afterConsecutiveFailures === 2, 'json export should include manual intervention threshold')
  assert(exported.metadata.spec.failurePolicy.manualIntervention.failureTextPatterns.includes('human review'), 'json export should include manual intervention pattern')
  assert(Array.isArray(exported.events), 'json export should include events')

  const outOutput = runCli(['loop', 'export', 'loop_cli_smoke', '--out', 'loop-export.md'], workspaceRoot)
  assertIncludes(outOutput, 'Exported loop: loop_cli_smoke', 'loop export --out should report success')
  const markdown = await readFile(resolve(workspaceRoot, 'loop-export.md'), 'utf8')
  assertIncludes(markdown, '# Loop CLI smoke', 'markdown export should include title')

  const stopOutput = runCli(['loop', 'stop', 'loop_cli_smoke'], workspaceRoot)
  assertIncludes(stopOutput, 'Stopped loop: loop_cli_smoke', 'loop stop should report success')
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
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    },
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
      total_tokens: 1,
    },
  }
}

function textResponse(content, usage = { total_tokens: 1 }) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
        },
      },
    ],
    usage,
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

async function pathExists(path) {
  try {
    await readFile(path, 'utf8')
    return true
  } catch {
    return false
  }
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
