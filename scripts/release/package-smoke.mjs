#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { stat, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
await stat(resolve(root, 'bin/pando.js'))
await stat(resolve(root, 'dist'))
const output = await runNpm(['pack', '--dry-run', '--json'])
assert(output.exitCode === 0, 'npm pack dry-run failed: ' + output.stderr)
assert(!output.stdout.includes('.pandoshare'), 'package dry-run should not include .pandoshare')
assert(!output.stdout.includes('.tmp'), 'package dry-run should not include .tmp')
await mkdir(resolve(root, 'docs/release'), { recursive: true })
await writeFile(resolve(root, 'docs/release/package-smoke.json'), output.stdout || '[]', 'utf8')
console.log('release package smoke passed')
function runNpm(args) { return process.platform === 'win32' ? run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args]) : run('npm', args) }
function run(command, args) { return new Promise(resolveRun => { const child = spawn(command, args, { cwd: root, windowsHide: true }); let stdout=''; let stderr=''; child.stdout.on('data', c => stdout += String(c)); child.stderr.on('data', c => stderr += String(c)); child.on('close', code => resolveRun({ exitCode: code, stdout, stderr })); child.on('error', error => resolveRun({ exitCode: 1, stdout, stderr: String(error) })); }) }
function assert(value, message) { if (!value) throw new Error(message) }
