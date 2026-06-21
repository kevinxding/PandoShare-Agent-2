#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
const manifest = { generatedAtMs: Date.now(), artifacts: ['docs/kernel/generated-acceptance-report.md', 'docs/security/security-acceptance-report.md', 'docs/release/generated-release-notes.md'], excluded: ['node_modules', 'dist cache', '.pandoshare', '.tmp'] }
await mkdir(resolve(root, 'docs/release'), { recursive: true })
await writeFile(resolve(root, 'docs/release/artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log('release artifact manifest generated')
