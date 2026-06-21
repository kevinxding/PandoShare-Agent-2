#!/usr/bin/env node
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
const core = await import('../dist/src/core/index.js')
const report = await core.writeSecurityAcceptanceReport(process.cwd())
assert(report.secretScan.scannedFiles > 0, 'security report should scan files')
assert(!JSON.stringify(report).match(/sk-[A-Za-z0-9_-]{12,}/), 'security report must not expose raw API keys')
await stat(resolve(process.cwd(), 'docs/security/security-acceptance-report.md'))
await stat(resolve(process.cwd(), 'docs/security/generated-security-acceptance-report.json'))
console.log('security report smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
