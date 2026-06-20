#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

const { LocalGoalStore } = await import('../dist/src/services/goalStore/index.js')
const { GoalRuntime } = await import('../dist/src/services/goalRuntime/index.js')
const { createDefaultToolRegistry } = await import('../dist/src/tools.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')

const root = process.cwd()
const mainPath = resolve(root, 'dist/src/main.js')
const smokeRoot = resolve(root, '.tmp-goal-store-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  await smokeStoreAndCompletionGuard(smokeRoot)
  await smokeGoalRuntime(smokeRoot)
  await smokeGoalTools(smokeRoot)
  await smokeCli(smokeRoot)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('goal store smoke passed')

async function smokeStoreAndCompletionGuard(workspaceRoot) {
  const store = new LocalGoalStore(workspaceRoot)
  const summary = await store.createGoal({
    goalId: 'goal_smoke',
    sessionId: 'goal-smoke',
    cwd: workspaceRoot,
    title: 'Goal smoke',
    objective: 'Prove goal storage and conservative completion.',
    requirements: ['Requirement one', 'Requirement two'],
  })
  assert(summary.metadata.status === 'active', 'new goal should be active')
  const goalRoot = resolve(workspaceRoot, '.pandoshare/goals/goal_smoke')
  for (const file of ['metadata.json', 'objective.md', 'requirements.jsonl', 'progress.jsonl', 'evidence.jsonl', 'runs.jsonl', 'checkpoints.jsonl']) {
    await readFile(resolve(goalRoot, file), 'utf8')
  }

  await expectReject(() => store.completeGoal('goal_smoke'), 'complete should reject incomplete requirements')
  const weakEvidence = await store.appendEvidence('goal_smoke', {
    type: 'loop',
    strength: 'direct',
    summary: 'Loop completed but this is not acceptance evidence.',
    requirementIds: ['req_1'],
  })
  await store.updateRequirement('goal_smoke', 'req_1', { status: 'completed', evidenceIds: [weakEvidence.evidenceId] })
  await expectReject(() => store.completeGoal('goal_smoke'), 'complete should reject non-acceptance evidence')

  const acceptanceOne = await store.appendEvidence('goal_smoke', {
    type: 'acceptance',
    strength: 'direct',
    summary: 'Acceptance proof one.',
    requirementIds: ['req_1'],
    acceptanceRunId: 'acceptance_1',
  })
  await store.updateRequirement('goal_smoke', 'req_1', { status: 'completed', evidenceIds: [acceptanceOne.evidenceId] })
  await expectReject(() => store.completeGoal('goal_smoke'), 'complete should reject missing second requirement evidence')

  const acceptanceTwo = await store.appendEvidence('goal_smoke', {
    type: 'acceptance',
    strength: 'direct',
    summary: 'Acceptance proof two.',
    requirementIds: ['req_2'],
    acceptanceRunId: 'acceptance_2',
  })
  await store.updateRequirement('goal_smoke', 'req_2', { status: 'completed', evidenceIds: [acceptanceTwo.evidenceId] })
  const completed = await store.completeGoal('goal_smoke')
  assert(completed.metadata.status === 'completed', 'complete should pass after every requirement has direct acceptance evidence')
  assert(completed.metadata.progressPercent === 100, 'completed goal should be 100%')

  const reopened = new LocalGoalStore(workspaceRoot)
  const exported = await reopened.readExport('goal_smoke')
  assert(exported.metadata.status === 'completed', 'goal should recover after store restart')
  assert(exported.evidence.length >= 3, 'goal export should include evidence')
  const md = await reopened.exportGoal('goal_smoke', 'md')
  assert(md.includes('Acceptance proof two'), 'markdown export should include evidence')
}

async function smokeGoalRuntime(workspaceRoot) {
  const store = new LocalGoalStore(workspaceRoot)
  await store.createGoal({
    goalId: 'goal_runtime_smoke',
    sessionId: 'goal-runtime-create',
    cwd: workspaceRoot,
    objective: 'Exercise GoalRuntime.',
    requirements: ['Runtime can continue active goal'],
  })
  const runtime = new GoalRuntime(store)
  const output = await runtime.resumeActiveGoal({
    sessionId: 'goal-runtime-run',
    idle: true,
    onContinue: () => ({ message: 'Runtime continued the active goal.', tokenUsage: 7 }),
  })
  assert(output.ok === true && output.status === 'continued', `runtime should continue: ${JSON.stringify(output)}`)
  const after = await store.readSummary('goal_runtime_smoke')
  assert(after.metadata.usageRunCount === 1, `expected one accounted run, got ${after.metadata.usageRunCount}`)
  assert(after.metadata.usageTokens === 7, `expected token accounting, got ${after.metadata.usageTokens}`)

  const failed = await runtime.continueGoal('goal_runtime_smoke', {
    sessionId: 'goal-runtime-fail',
    onContinue: () => {
      throw new Error('planned runtime error')
    },
  })
  assert(failed.ok === false && failed.status === 'failed', 'runtime should stop conservatively on error')
}

async function smokeGoalTools(workspaceRoot) {
  const registry = createDefaultToolRegistry()
  assert(registry.has('get_goal'), 'registry should expose get_goal')
  assert(registry.has('create_goal'), 'registry should expose create_goal')
  assert(registry.has('update_goal'), 'registry should expose update_goal')
  const context = {
    cwd: workspaceRoot,
    sessionId: 'goal-tools',
    permissionMode: 'default',
    permissions: {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    },
  }
  const create = await runTool(registry, context, 'create_goal', {
    goalId: 'goal_tool_smoke',
    objective: 'Tool-created goal.',
    requirements: ['Tool requirement'],
  })
  assert(create.ok, `create_goal should pass: ${create.content}`)
  const get = await runTool(registry, context, 'get_goal', { goalId: 'goal_tool_smoke' })
  assert(get.ok && get.content.includes('Tool-created goal'), 'get_goal should return goal content')
  const complete = await runTool(registry, context, 'update_goal', {
    goalId: 'goal_tool_smoke',
    status: 'completed',
  })
  assert(!complete.ok, 'update_goal completed should reject missing acceptance evidence')
}

async function smokeCli(workspaceRoot) {
  const create = runCli(workspaceRoot, ['goal', 'create', '--id', 'goal_cli_smoke', '--objective', 'CLI goal objective', '--requirement', 'CLI requirement'])
  assert(create.status === 0, `goal create failed: ${create.stderr}`)
  assert(create.stdout.includes('Created goal: goal_cli_smoke'), 'goal create should print id')
  const list = runCli(workspaceRoot, ['goal', 'list'])
  assert(list.status === 0 && list.stdout.includes('goal_cli_smoke'), 'goal list should include created goal')
  const status = runCli(workspaceRoot, ['goal', 'status', 'goal_cli_smoke'])
  assert(status.status === 0 && status.stdout.includes('Status: active'), 'goal status should show active')
  const pause = runCli(workspaceRoot, ['goal', 'pause', 'goal_cli_smoke'])
  assert(pause.status === 0 && pause.stdout.includes('Status: paused'), 'goal pause should work')
  const resume = runCli(workspaceRoot, ['goal', 'resume', 'goal_cli_smoke'])
  assert(resume.status === 0 && resume.stdout.includes('Status: active'), 'goal resume should work')
  const block = runCli(workspaceRoot, ['goal', 'block', 'goal_cli_smoke', '--reason', 'manual blocker'])
  assert(block.status === 0 && block.stdout.includes('Status: blocked'), 'goal block should work for user CLI')
  const inspect = runCli(workspaceRoot, ['goal', 'inspect', 'goal_cli_smoke'])
  assert(inspect.status === 0 && inspect.stdout.includes('Requirements:'), 'goal inspect should show requirements')
  const exported = runCli(workspaceRoot, ['goal', 'export', 'goal_cli_smoke', '--format', 'json'])
  assert(exported.status === 0 && JSON.parse(exported.stdout).metadata.goalId === 'goal_cli_smoke', 'goal export json should parse')
  const complete = runCli(workspaceRoot, ['goal', 'complete', 'goal_cli_smoke'])
  assert(complete.status !== 0, 'goal complete should reject missing acceptance evidence')
}

async function runTool(registry, context, name, input) {
  const results = []
  for await (const update of runTools([{ id: `call_${name}_${Date.now()}`, name, input }], registry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `${name} should return one result`)
  return results[0]
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [mainPath, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function expectReject(fn, message) {
  try {
    await fn()
  } catch {
    return
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertInside(base, target) {
  const rel = relative(resolve(base), resolve(target))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escaped workspace: ${target}`)
  }
}
