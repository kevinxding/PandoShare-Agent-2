#!/usr/bin/env node
const core = await import('../../dist/src/core/index.js')
const report = await new core.ChaosRunner({ workspaceRoot: process.cwd(), durationMs: 2500, intervalMs: 10, maxIterations: 12, seed: 1 }).run()
console.log('chaos short run passed: ' + report.iterations + ' iterations')
