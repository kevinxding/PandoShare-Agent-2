#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const requiredPaths = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'tsconfig.json',
  'docs/architecture.md',
  'docs/teacher-map.md',
  'src/main.tsx',
  'src/query.ts',
  'src/QueryEngine.ts',
  'src/Tool.ts',
  'src/tools.ts',
  'src/entrypoints/cli.tsx',
  'src/services/tools/toolOrchestration.ts',
  'src/services/tools/toolExecution.ts',
  'src/services/gui/index.ts',
  'src/tools/GuiTool/index.ts',
  'src/tools/PowerShellTool/index.ts',
  'src/tools/MCPTool/index.ts',
  'src/utils/generators.ts',
  'src/utils/abortController.ts',
  'src/utils/env.ts',
]

const missing = requiredPaths.filter(path => !existsSync(join(root, path)))

function isAscii(value) {
  return /^[\x00-\x7F]*$/.test(value)
}

const nonAsciiRequired = requiredPaths.filter(path => !isAscii(path))

const teacherMapPath = join(root, 'docs/teacher-map.md')
const teacherMap = existsSync(teacherMapPath) ? readFileSync(teacherMapPath, 'utf8') : ''
const requiredTeacherMarkers = [
  'OpenCode',
  'Codex',
  'Claude Code-like source',
  'Hermes Agent',
  'Dingxu GUI',
  'src/services/llm/*',
  'src/QueryEngine.ts',
  'src/services/gatewayRuntime/*',
  'src/services/loopRuntime/*',
  'src/services/goalStore/*',
  'src/services/gui/*',
]
const missingTeacherMarkers = requiredTeacherMarkers.filter(marker => !teacherMap.includes(marker))

if (missing.length > 0 || nonAsciiRequired.length > 0 || missingTeacherMarkers.length > 0) {
  if (missing.length > 0) {
    console.error('Missing required architecture paths:')
    for (const item of missing) console.error(`- ${item}`)
  }
  if (nonAsciiRequired.length > 0) {
    console.error('Non-ASCII required paths:')
    for (const item of nonAsciiRequired) console.error(`- ${item}`)
  }
  if (missingTeacherMarkers.length > 0) {
    console.error('Missing required teacher-map markers:')
    for (const item of missingTeacherMarkers) console.error(`- ${item}`)
  }
  process.exit(1)
}

console.log('Architecture check passed.')
console.log(`Root: ${relative(process.cwd(), root) || '.'}`.split(sep).join('/'))
console.log(`Checked paths: ${requiredPaths.length}`)
