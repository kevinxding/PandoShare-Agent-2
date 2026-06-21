#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { GuiBenchmarkRunner } = await import(resolveBenchmarkModule())

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gui-real-probe-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const env = { ...process.env }
  delete env.PANDO_GUI_REAL
  const run = await new GuiBenchmarkRunner({
    workspaceRoot: smokeRoot,
    manifestPath: resolve(root, 'benchmarks/gui-real/manifest.json'),
    outputDir: resolve(smokeRoot, 'report'),
    runId: 'gui_real_probe_smoke',
    ids: ['dingxu-health'],
    env,
  }).run()
  const probe = result(run, 'dingxu-health')
  assert(run.status === 'partial', `real probe skip should make run partial, got ${run.status}`)
  assert(probe.status === 'skipped', `real probe should skip without env, got ${probe.status}`)
  assert(probe.metrics.failureReason === 'skipped_real_gui', `expected skipped_real_gui, got ${probe.metrics.failureReason}`)
  assert(probe.evidence?.dingxuProbeCode === 'skipped_real_gui', 'probe evidence should carry skipped_real_gui')
  const markdown = await readFile(run.files.markdownPath, 'utf8')
  assert(markdown.includes('Success rate:'), 'real probe report should contain success rate')
  assert(markdown.includes('skipped_real_gui'), 'real probe report should name skipped_real_gui')
  console.log('gui real probe smoke passed')
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

