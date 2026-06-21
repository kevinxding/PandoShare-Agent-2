#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
const doc = '# 72h Chaos Runbook

This command is explicit and not run by default.

Run: npm run chaos:72h -- --duration-ms 259200000 --keep-workspace

Requirements: stable machine power, writable workspace, no real GUI/network unless explicitly configured, and operator review of docs/chaos/latest-smoke-report.md. Interrupt with Ctrl+C; resume by starting a new run and preserving the workspace.
'
await mkdir(resolve(root, 'docs/chaos'), { recursive: true })
await writeFile(resolve(root, 'docs/chaos/72h-runbook.md'), doc, 'utf8')
console.log('chaos 72h plan generated')
