#!/usr/bin/env node
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
const core = await import('../../dist/src/core/index.js')
const report = await new core.ChaosRunner({ workspaceRoot: process.cwd(), durationMs: 1000, maxIterations: 8, seed: 5 }).run()
assert(report.failures >= 1, 'chaos report should classify nonfatal failures')
await stat(resolve(process.cwd(), 'docs/chaos/latest-smoke-report.md'))
await stat(resolve(process.cwd(), 'docs/chaos/latest-smoke-report.json'))
console.log('chaos report smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
