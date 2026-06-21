#!/usr/bin/env node
const golden = await import('../dist/src/core/replay-golden/index.js')
const root = process.cwd()
const traces = await golden.loadAllGoldenTraces(golden.defaultGoldenTraceRoot(root))
const trace = traces.find(item => item.name === 'run-basic') ?? traces[0]
const report = golden.buildGoldenTraceReport(trace)
const broken = {
  ...report,
  incidents: report.incidents.slice(1),
  graph: { ...report.graph, edges: report.graph.edges.slice(1) },
  projections: {
    ...report.projections,
    run: { ...report.projections.run, status: report.projections.run.status === 'failed' ? 'completed' : 'failed' },
  },
}
const diff = golden.compareGoldenTraceReport(trace, broken, { markdown: '# Broken Report\n' })
assert(diff.ok === false, 'broken report should produce a diff')
for (const heading of ['## Missing Section', '## Incident Diff', '## Graph Edge Diff', '## Projection Status Diff']) {
  assert(diff.markdown.includes(heading), 'diff markdown should include ' + heading)
}
assert(diff.differences.some(item => item.includes('missing markdown section')), 'diff should detect missing section')
assert(diff.differences.some(item => item.includes('edge')), 'diff should detect graph edge difference')
assert(diff.differences.some(item => item.includes('projection status')), 'diff should detect projection status difference')
console.log('replay golden diff smoke passed')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
