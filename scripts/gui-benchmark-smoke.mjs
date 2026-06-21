#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { GuiBenchmarkRunner } = await import(resolveBenchmarkModule())

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gui-benchmark-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const outputDir = resolve(smokeRoot, 'report')
  const run = await new GuiBenchmarkRunner({
    workspaceRoot: smokeRoot,
    manifestPath: resolve(root, 'benchmarks/gui-real/manifest.json'),
    outputDir,
    runId: 'gui_benchmark_smoke',
    ids: ['mock-click', 'mock-type'],
  }).run()
  assert(run.status === 'passed', `mock GUI benchmark should pass: ${run.status}`)
  assert(run.passedCount === 2, `expected two passing mock scenarios, got ${run.passedCount}`)
  const click = result(run, 'mock-click')
  assert(click.metrics.success === true, 'mock click should report metrics.success=true')
  assert(click.metrics.verificationStatus === 'passed', `mock click verification should pass, got ${click.metrics.verificationStatus}`)
  assert(click.metrics.screenshotRefs.length >= 1, 'mock click should include screenshot refs')
  const markdown = await readFile(run.files.markdownPath, 'utf8')
  assert(markdown.includes('Success rate:'), 'GUI benchmark report should contain success rate')
  console.log('gui benchmark smoke passed')
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

