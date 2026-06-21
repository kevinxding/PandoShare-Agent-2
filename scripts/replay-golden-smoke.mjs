#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const golden = await import('../dist/src/core/replay-golden/index.js')
const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const traceRoot = golden.defaultGoldenTraceRoot(root)
const smokeRoot = resolve(root, '.tmp-replay-golden-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })
try {
  const traces = await golden.loadAllGoldenTraces(traceRoot)
  assert(traces.length >= 6, 'expected at least 6 golden traces')
  const results = traces.map(trace => golden.validateGoldenTrace(trace))
  const failed = results.filter(result => !result.ok)
  assert(failed.length === 0, failed.map(result => result.traceName + ': ' + result.errors.join('; ')).join('\n'))
  for (const result of results) {
    assert(result.report.metadata.eventCount > 0, result.traceName + ' should have events')
    assert(result.report.metadata.eventCount === result.report.timeline.length, result.traceName + ' timeline should match event count')
  }
  const runBasic = traces.find(trace => trace.name === 'run-basic') ?? traces[0]
  const durable = new core.DurableRuntime({ workspaceRoot: smokeRoot, workspaceId: runBasic.events[0].workspaceId })
  await durable.appendEvents(runBasic.events, { importMode: true })
  const serviceReport = await new core.ReplayService(durable).buildReport(runBasic.expectedReportShape.query)
  assert(serviceReport.timeline.length === runBasic.events.length, 'ReplayService should build report from golden events')
  assert(serviceReport.incidents.length === runBasic.expectedIncidents.length, 'ReplayService incident count should match run-basic expectation')
  console.log('replay golden smoke passed')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error('Refusing to use path outside workspace: ' + targetPath)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
