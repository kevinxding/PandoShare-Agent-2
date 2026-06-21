#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const tmp = resolve(root, '.tmp-security-secret-smoke')
await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })
try {
  await writeFile(resolve(tmp, 'fixture.ts'), 'const key = "sk-testsecret1234567890"\nconst auth = "Bearer tokenvalue1234567890"\n', 'utf8')
  const scanner = new core.SecretScanner(root)
  const report = await scanner.scan(['.tmp-security-secret-smoke'])
  assert(report.findingCount >= 2, 'scanner should find fixture secrets')
  assert(!JSON.stringify(report).includes('sk-testsecret1234567890'), 'report must redact raw API key')
  console.log('security secret smoke passed')
} finally { await rm(tmp, { recursive: true, force: true }) }
function assert(value, message) { if (!value) throw new Error(message) }
