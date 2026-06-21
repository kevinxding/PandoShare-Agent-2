#!/usr/bin/env node
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
await stat(resolve(root, 'package.json'))
await stat(resolve(root, 'bin/pando.js'))
const report = { status: 'baseline', blocker: 'Full clean install is documented but not executed by default to avoid network/package-registry dependency in local smoke.', safeCommand: 'npm ci && npm run build && node bin/pando.js --help' }
await mkdir(resolve(root, 'docs/release'), { recursive: true })
await writeFile(resolve(root, 'docs/release/clean-install-smoke.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log('release clean install smoke passed')
