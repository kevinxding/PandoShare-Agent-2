#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = process.cwd()
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
assert(pkg.version, 'package version missing')
const report = { package: pkg.name, version: pkg.version, private: pkg.private === true, publishable: pkg.private !== true, blockers: pkg.private === true ? ['not publishable until owner changes private flag'] : [] }
await mkdir(resolve(root, 'docs/release'), { recursive: true })
await writeFile(resolve(root, 'docs/release/version-check.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log('release version check passed')
function assert(value, message) { if (!value) throw new Error(message) }
