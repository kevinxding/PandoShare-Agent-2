#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { GuiBenchmarkRunner } = await import(resolveBenchmarkModule())

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gui-recovery-benchmark-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const run = await new GuiBenchmarkRunner({
    workspaceRoot: smokeRoot,
    manifestPath: resolve(root, 'benchmarks/gui-real/manifest.json'),
    outputDir: resolve(smokeRoot, 'report'),
    runId: 'gui_recovery_benchmark_smoke',
    ids: ['mock-stuck', 'mock-approval'],
  }).run()
  assert(run.status === 'passed', `recovery benchmark should pass, got ${run.status}`)
  const stuck = result(run, 'mock-stuck')
  assert(stuck.metrics.stuckDetected === true, 'mock stuck should set stuckDetected=true')
  assert(stuck.metrics.inputReleased === true, 'mock stuck should set inputReleased=true')
  assert(stuck.metrics.recoveryDecision === 'requires_human', `mock stuck recovery should require human, got ${stuck.metrics.recoveryDecision}`)
  assert(stuck.metrics.eventIds.length >= 1, 'mock stuck should include event ids')

  const approval = result(run, 'mock-approval')
  assert(approval.metrics.approvalRequired === true, 'approval scenario should require approval')
  assert(approval.metrics.verificationStatus === 'skipped', `approval verification should be skipped, got ${approval.metrics.verificationStatus}`)
  assert(approval.evidence?.actionExecuted === false, 'approval scenario must wait without executing write action')
  assert(approval.evidence?.adapterActionCount === 0, `approval adapter action count should be 0, got ${approval.evidence?.adapterActionCount}`)

  const markdown = await readFile(run.files.markdownPath, 'utf8')
  assert(markdown.includes('Success rate:'), 'recovery benchmark report should contain success rate')
  console.log('gui recovery benchmark smoke passed')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function result(run, id) {
  const found = run.results.find(item => item.id === id)
  assert(found, `missing scenario result ${id}`)
  return found
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function resolveBenchmarkModule() {
  const ref = process.env.GUI_BENCHMARK_MODULE ?? '../dist/src/core/gui-benchmark/index.js'
  return ref.startsWith('.') || ref.startsWith('file:') || ref.includes('://') ? ref : pathToFileURL(ref).href
}

