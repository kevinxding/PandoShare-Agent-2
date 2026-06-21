#!/usr/bin/env node
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()

export async function runSmoke(name) {
  const smokeRoot = resolve(root, '.tmp-productization-smoke', safeName(name))
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
  await mkdir(smokeRoot, { recursive: true })
  try {
    const fn = SMOKES[name]
    if (!fn) throw new Error('Unknown productization smoke: ' + name)
    await fn(smokeRoot)
    console.log(name + ' passed')
  } finally {
    assertInside(root, smokeRoot)
    await rm(smokeRoot, { recursive: true, force: true })
  }
}

const SMOKES = {
  'backend-service': smokeBackendService,
  'backend-contract': smokeBackendContract,
  'tool-runtime': smokeToolRuntime,
  'code-agent-harness': smokeCodeAgentHarness,
  'code-agent-fixture': smokeCodeAgentFixture,
  'patch-verifier': smokePatchVerifier,
  'benchmark': smokeBenchmarkAll,
  'benchmark-code': root => smokeBenchmarkCategory(root, 'code'),
  'benchmark-loop': root => smokeBenchmarkCategory(root, 'loop'),
  'benchmark-gateway': root => smokeBenchmarkCategory(root, 'gateway'),
  'benchmark-gui': root => smokeBenchmarkCategory(root, 'gui'),
  'benchmark-report': smokeBenchmarkReport,
  'context-runtime': smokeContextRuntime,
  'evidence-pack': smokeEvidencePack,
  'memory-store': smokeMemoryStore,
  'compaction-runtime': smokeCompactionRuntime,
  'context-budget': smokeContextBudget,
  'worktree': smokeWorktree,
  'sandbox-policy': smokeSandboxPolicy,
  'permission-profile': smokePermissionProfile,
  'path-policy': smokePathPolicy,
  'command-policy': smokeCommandPolicy,
  'productization-phase': smokeProductizationPhase,
}

async function smokeBackendService(smokeRoot) {
  const service = new core.BackendService({ workspaceRoot: smokeRoot, source: 'test', config: fakeModelConfig() })
  const health = await service.handle({ action: 'system.health' })
  assert(health.ok === true, 'system.health should pass')
  assert(Array.isArray(health.eventIds) && health.eventIds.length >= 2, 'backend should emit telemetry events')
  const model = await service.handle({ action: 'model.route', payload: { taskType: 'code', contextTokensNeeded: 1000 } })
  assert(model.ok === true, 'model.route should pass')
}

async function smokeBackendContract(smokeRoot) {
  const service = new core.BackendService({ workspaceRoot: smokeRoot, source: 'test', config: fakeModelConfig() })
  const status = service.status()
  assert(status.data.supportedActions.includes('system.acceptance'), 'status should expose supported actions')
  const acceptance = await service.handle({ action: 'system.acceptance' })
  assert(acceptance.ok === true, 'system.acceptance should pass')
  assert(acceptance.data.checks.directImportPath === 'src/core/backend/index.ts', 'acceptance contract should name direct import path')
  let threw = false
  try {
    await service.handle({ action: 'invalid.action' })
  } catch {
    threw = true
  }
  assert(threw, 'unsupported backend action should be rejected before dispatch')
}

async function smokeToolRuntime(smokeRoot) {
  const runtime = new core.ToolRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default', resultRoot: resolve(smokeRoot, '.results') })
  const write = await runtime.execute({ toolName: 'file_write', approvalPolicy: 'trusted', input: { path: 'notes/a.txt', content: 'hello' } })
  assert(write.state === 'completed', 'file_write should complete')
  assert(write.resultRef?.relativePath, 'file_write should store result ref')
  const read = await runtime.execute({ toolName: 'file_read', input: { path: 'notes/a.txt' } })
  assert(read.result?.output === 'hello', 'file_read should read written content')
  const patch = await runtime.execute({ toolName: 'apply_patch', approvalPolicy: 'trusted', input: { path: 'notes/a.txt', search: 'hello', replace: 'hello pando' } })
  assert(patch.state === 'completed', 'apply_patch should complete')
  const shell = await runtime.execute({ toolName: 'shell', approvalPolicy: 'trusted', input: { command: 'node', args: ['-e', 'console.log("ok")'], timeoutMs: 5000 } })
  assert(shell.result?.shell?.stdout.includes('ok'), 'shell should capture stdout')
}

async function smokeCodeAgentHarness(smokeRoot) {
  const harness = new core.CodeAgentHarness({ tempRoot: smokeRoot })
  const fixture = await harness.loadFixture(resolve(root, 'tests/fixtures/code-agent/simple-ts-bug/fixture.json'))
  const result = await harness.runFixture(fixture)
  assert(result.status === 'passed', 'simple code-agent fixture should pass')
}

async function smokeCodeAgentFixture(smokeRoot) {
  const harness = new core.CodeAgentHarness({ tempRoot: smokeRoot })
  const fixtureRoots = ['simple-ts-bug', 'readme-update', 'failing-test-fix']
  for (const fixtureName of fixtureRoots) {
    const fixture = await harness.loadFixture(resolve(root, 'tests/fixtures/code-agent', fixtureName, 'fixture.json'))
    const result = await harness.runFixture(fixture)
    assert(result.status === 'passed', fixtureName + ' should pass')
  }
}

async function smokePatchVerifier(smokeRoot) {
  const runtime = new core.ToolRuntime({ workspaceRoot: smokeRoot, workspaceId: 'default' })
  await runtime.execute({ toolName: 'file_write', approvalPolicy: 'trusted', input: { path: 'src/app.js', content: 'export const ok = true\n' } })
  const result = await new core.PatchVerifier().verify(smokeRoot, {
    changedFiles: ['src/app.js'],
    forbiddenPaths: ['outside.txt'],
    mustContain: [{ path: 'src/app.js', text: 'ok = true' }],
  })
  assert(result.ok === true, 'patch verifier should pass expected file checks')
}

async function smokeBenchmarkAll(smokeRoot) {
  const run = await new core.BenchmarkRunner({ manifestPath: resolve(root, 'benchmarks/benchmark-manifest.json'), outputDir: smokeRoot, runId: 'benchmark_smoke' }).run()
  assert(run.status === 'passed', 'benchmark pack should pass')
  assert(run.caseCount >= 7, 'benchmark pack should include all offline cases')
}

async function smokeBenchmarkCategory(smokeRoot, category) {
  const run = await new core.BenchmarkRunner({ manifestPath: resolve(root, 'benchmarks/benchmark-manifest.json'), outputDir: smokeRoot, runId: 'benchmark_' + category, categories: [category] }).run()
  assert(run.status === 'passed', category + ' benchmark should pass')
  assert(run.results.every(result => result.category === category), 'category filter should select only ' + category)
}

async function smokeBenchmarkReport(smokeRoot) {
  const run = await new core.BenchmarkRunner({ manifestPath: resolve(root, 'benchmarks/benchmark-manifest.json'), outputDir: smokeRoot, runId: 'benchmark_report' }).run()
  assert(await exists(run.files.jsonPath), 'benchmark json report should exist')
  assert(await exists(run.files.markdownPath), 'benchmark markdown report should exist')
  const markdown = await readFile(run.files.markdownPath, 'utf8')
  assert(markdown.includes('Benchmark'), 'benchmark markdown should contain heading text')
}

async function smokeContextRuntime() {
  const context = new core.ContextRuntime().buildContext({
    threadId: 'thread_context_smoke',
    profile: 'build',
    budgetTokens: 32,
    fragments: [
      fragment('system', 'sys', 'stay factual', 100),
      fragment('message', 'old', 'x'.repeat(1000), 1),
      fragment('memory', 'mem', 'important project memory', 90),
    ],
  })
  assert(context.contextId.startsWith('context_'), 'context should have id')
  assert(context.audit.some(item => item.decision === 'dropped'), 'context should drop low-priority fragment under budget')
  assert(context.systemInstructions.length >= 1, 'context should include identity/system fragments')
}

async function smokeEvidencePack() {
  const evidence = core.createEvidencePack({ title: 'Model trace', refs: [{ kind: 'model', ref: 'route_1' }], summary: 'token: sk-1234567890abcdef', reason: 'smoke' })
  assert(evidence.summary.includes('<redacted>'), 'evidence summary should redact secrets')
  assert(evidence.provenance.source === 'evidence', 'evidence should carry provenance')
}

async function smokeMemoryStore(smokeRoot) {
  const store = new core.MemoryStore(resolve(smokeRoot, 'memory.jsonl'))
  await store.append({ scope: 'project', source: 'smoke', content: 'api_key=sk-1234567890abcdef', tags: ['smoke'] })
  const records = await store.read({ scope: 'project' })
  assert(records.length === 1, 'memory record should persist')
  assert(records[0].redacted === true && records[0].content.includes('<redacted>'), 'memory should redact secrets')
}

async function smokeCompactionRuntime() {
  const runtime = new core.CompactionRuntime()
  const result = await runtime.compact({ messages: [{ role: 'assistant', toolCalls: [{ id: 'call_1' }] }, { role: 'tool', toolCallId: 'call_1' }], summaryParts: ['summary ok'] })
  assert(result.ok === true, 'paired tool transcript should compact')
  assert(result.summary === 'summary ok', 'summaryParts should be preserved')
  const failed = await runtime.compact({ messages: [{ role: 'assistant', toolCalls: [{ id: 'missing' }] }] })
  assert(failed.ok === false, 'missing tool result should fail verification')
}

async function smokeContextBudget() {
  const fitted = core.fitFragmentsToBudget([
    { ...fragment('system', 'protected', 'protected fragment', 100), protected: true },
    fragment('message', 'large', 'x'.repeat(1000), 1),
  ], 1)
  assert(fitted.included.some(item => item.fragmentId === 'protected'), 'protected fragments should survive budget')
  assert(fitted.dropped.some(item => item.fragmentId === 'large'), 'large low-priority fragment should drop')
}

async function smokeWorktree(smokeRoot) {
  await mkdir(resolve(smokeRoot, 'source'), { recursive: true })
  await new core.ToolRuntime({ workspaceRoot: resolve(smokeRoot, 'source') }).execute({ toolName: 'file_write', approvalPolicy: 'trusted', input: { path: 'a.txt', content: 'copy me' } })
  const manager = new core.WorktreeManager({ tempRoot: resolve(smokeRoot, 'leases') })
  const lease = await manager.acquireLease({ sourcePath: resolve(smokeRoot, 'source'), preferGitWorktree: false, leaseId: 'lease_smoke' })
  assert(lease.mode === 'temp_copy', 'non-git source should use temp copy')
  assert(await exists(resolve(lease.rootPath, 'a.txt')), 'lease should copy source file')
  const cleanup = await manager.cleanupLease(lease)
  assert(cleanup.removed === true, 'lease cleanup should remove copy')
}

async function smokeSandboxPolicy(smokeRoot) {
  const policy = new core.SandboxPolicy({ workspaceRoot: smokeRoot, sandboxMode: 'workspace-write' })
  assert(policy.checkTool({ name: 'read', safety: 'read_only' }).decision === 'allow', 'read tool should be allowed')
  assert(policy.checkGuiAction({ action: 'click' }).decision === 'ask', 'GUI write should ask')
  assert(policy.checkGatewayAction({ action: 'delete' }).decision === 'deny', 'dangerous gateway action should deny')
}

async function smokePermissionProfile(smokeRoot) {
  const readonly = new core.PermissionEngine({ profile: 'readonly', workspaceRoot: smokeRoot })
  assert(readonly.checkPath({ path: 'a.txt', operation: 'write' }).decision === 'deny', 'readonly profile should deny writes')
  const build = new core.PermissionEngine({ profile: 'build', workspaceRoot: smokeRoot })
  assert(build.checkPath({ path: 'a.txt', operation: 'write', trusted: true }).decision === 'allow', 'build profile should allow workspace writes')
  assert(build.listAuditRecords().length >= 1, 'permission checks should be audited')
}

async function smokePathPolicy(smokeRoot) {
  const policy = new core.PathPolicy({ workspaceRoot: smokeRoot, sandboxMode: 'workspace-write' })
  assert(policy.checkPath({ path: 'inside.txt', operation: 'write' }).decision === 'allow', 'inside write should allow')
  assert(policy.checkPath({ path: resolve(smokeRoot, '..', 'outside.txt'), operation: 'write' }).decision === 'ask', 'outside write should ask')
  assert(policy.checkPath({ path: smokeRoot, operation: 'delete' }).decision === 'deny', 'workspace root delete should deny')
}

async function smokeCommandPolicy(smokeRoot) {
  const policy = new core.CommandPolicy({ workspaceRoot: smokeRoot, sandboxMode: 'workspace-write' })
  assert(policy.checkCommand({ command: 'node -v', cwd: smokeRoot }).decision === 'allow', 'benign command should allow')
  assert(policy.checkCommand({ command: 'git reset --hard', cwd: smokeRoot }).decision === 'deny', 'git reset --hard should deny')
  assert(policy.checkCommand({ command: 'git push origin main', cwd: smokeRoot }).decision === 'ask', 'git push should ask')
}

async function smokeProductizationPhase(smokeRoot) {
  await smokeBackendService(resolve(smokeRoot, 'backend'))
  await smokeToolRuntime(resolve(smokeRoot, 'tool'))
  await smokeCodeAgentHarness(resolve(smokeRoot, 'code-agent'))
  await smokeBenchmarkCategory(resolve(smokeRoot, 'benchmark'), 'code')
  await smokeContextRuntime(resolve(smokeRoot, 'context'))
  await smokeMemoryStore(resolve(smokeRoot, 'memory'))
  await smokeCompactionRuntime(resolve(smokeRoot, 'compaction'))
  await smokeWorktree(resolve(smokeRoot, 'worktree'))
  await smokeSandboxPolicy(resolve(smokeRoot, 'sandbox'))
  await smokePermissionProfile(resolve(smokeRoot, 'permission'))
}

function fragment(kind, id, content, priority) {
  return {
    fragmentId: id,
    kind,
    content,
    estimatedTokens: Math.max(1, Math.ceil(content.length / 4)),
    provenance: core.createContextProvenance({ source: kind, sourceId: id, reason: 'smoke ' + id, priority }),
  }
}

function fakeModelConfig() {
  return {
    providers: {
      cheap: {
        name: 'Cheap Test Provider',
        baseURL: 'https://cheap.example.invalid/v1',
        model: 'cheap-model',
        protocol: 'openai-chat-completions',
        auth: { type: 'none' },
        capabilities: { tools: true, vision: false, streaming: true, reasoning: true, contextWindowTokens: 128000 },
      },
    },
    model: { provider: 'cheap', name: 'cheap-model' },
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function safeName(input) {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_') || 'smoke'
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error('Refusing to use path outside workspace: ' + targetPath)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
