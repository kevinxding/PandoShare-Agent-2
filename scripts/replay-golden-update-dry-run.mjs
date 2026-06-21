#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const golden = await import('../dist/src/core/replay-golden/index.js')
const root = process.cwd()
const traceRoot = golden.defaultGoldenTraceRoot(root)
const before = await snapshotFiles(traceRoot)
const results = await golden.updateAllGoldenTraces(traceRoot, { write: false })
const after = await snapshotFiles(traceRoot)
assert(results.length >= 6, 'dry-run should inspect at least 6 traces')
assert(results.every(result => result.wrote === false), 'dry-run must not write files')
assert(JSON.stringify(before) === JSON.stringify(after), 'dry-run must not modify golden files')
assert(results.every(result => result.files.some(file => file.fileName === 'expected-incidents.json')), 'dry-run should return expected incident candidates')
console.log('replay golden update dry-run smoke passed')

async function snapshotFiles(dir) {
  const out = {}
  await visit(dir, out)
  return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)))
}

async function visit(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await visit(path, out)
    } else {
      out[path] = await readFile(path, 'utf8')
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
