#!/usr/bin/env node
const golden = await import('../dist/src/core/replay-golden/index.js')
const root = process.cwd()
const results = await golden.validateAllGoldenTraces(golden.defaultGoldenTraceRoot(root))
const markdown = golden.renderGoldenTraceValidationReport(results)
assert(markdown.includes('# Replay Golden Trace Validation'), 'report should have title')
assert(markdown.includes('Status: ok'), 'report should be ok')
for (const name of ['run-basic', 'loop-gui-gateway-model', 'incident-duplicate-terminal', 'unsafe-recovery', 'model-fallback', 'gateway-delivery-retry']) {
  assert(markdown.includes(name), 'report should mention ' + name)
}
console.log('replay golden report smoke passed')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
