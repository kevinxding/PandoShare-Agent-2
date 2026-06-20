import { stat } from 'node:fs/promises'

import type { ToolUseContext } from '../../Tool.js'
import {
  defaultShellCommand,
  globToRegExp,
  listWorkspaceFiles,
  readWorkspaceText,
  resolveWorkspacePath,
  runProcess,
} from '../../tools/shared/index.js'

export type LspAction = 'diagnostics' | 'symbols' | 'definition' | 'references'

export type LspResult = {
  ok: boolean
  action: LspAction
  unsupported?: boolean
  message?: string
  items: LspItem[]
}

export type LspItem = {
  path: string
  line: number
  column: number
  kind: string
  name?: string
  text?: string
}

export async function runLspAction(
  context: ToolUseContext,
  input: {
    action: LspAction
    path?: string
    symbol?: string
    pattern?: string
    maxResults?: number
    timeoutMs?: number
  },
): Promise<LspResult> {
  const maxResults = input.maxResults ?? 100
  if (input.action === 'diagnostics') return runDiagnostics(context, input.timeoutMs ?? 30_000, maxResults)
  if (input.action === 'symbols') return findSymbols(context, input.path ?? '.', input.pattern ?? '**/*.{ts,tsx,js,jsx,py}', maxResults)
  const symbol = input.symbol?.trim()
  if (!symbol) throw new Error('symbol must be a non-empty string')
  const references = await findReferences(context, symbol, input.path ?? '.', maxResults)
  return {
    ok: true,
    action: input.action,
    items: input.action === 'definition' ? references.filter(item => item.kind === 'definition').slice(0, maxResults) : references,
  }
}

async function runDiagnostics(context: ToolUseContext, timeoutMs: number, maxResults: number): Promise<LspResult> {
  const tsconfig = resolveWorkspacePath(context, 'tsconfig.json')
  try {
    if (!(await stat(tsconfig.absolutePath)).isFile()) throw new Error('No tsconfig.json found.')
  } catch {
    return {
      ok: true,
      action: 'diagnostics',
      unsupported: true,
      message: 'Diagnostics are available for TypeScript workspaces with tsconfig.json.',
      items: [],
    }
  }
  const command = defaultShellCommand('npx --yes -p typescript@5.8.2 tsc --noEmit --pretty false')
  const result = await runProcess({
    command: command.command,
    args: command.args,
    cwd: context.cwd,
    timeoutMs,
    maxOutputChars: 80_000,
    abortSignal: context.abortSignal,
  })
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    action: 'diagnostics',
    message: result.exitCode === 0 ? 'No diagnostics.' : 'TypeScript diagnostics found.',
    items: parseTscDiagnostics(`${result.stdout}\n${result.stderr}`).slice(0, maxResults),
  }
}

async function findSymbols(context: ToolUseContext, rootPath: string, pattern: string, maxResults: number): Promise<LspResult> {
  const files = await matchingCodeFiles(context, rootPath, pattern, maxResults * 5)
  const items: LspItem[] = []
  for (const file of files) {
    const { text } = await readWorkspaceText(file, 400_000)
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length && items.length < maxResults; index += 1) {
      const match = symbolPattern().exec(lines[index] ?? '')
      if (!match?.groups?.name) continue
      items.push({
        path: file.relativePath,
        line: index + 1,
        column: match.index + 1,
        kind: 'symbol',
        name: match.groups.name,
        text: lines[index]?.trim(),
      })
    }
    if (items.length >= maxResults) break
  }
  return { ok: true, action: 'symbols', items }
}

async function findReferences(context: ToolUseContext, symbol: string, rootPath: string, maxResults: number): Promise<LspItem[]> {
  const files = await matchingCodeFiles(context, rootPath, '**/*.{ts,tsx,js,jsx,py}', maxResults * 10)
  const word = new RegExp(`\\b${escapeRegExp(symbol)}\\b`)
  const items: LspItem[] = []
  for (const file of files) {
    const { text } = await readWorkspaceText(file, 400_000)
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length && items.length < maxResults; index += 1) {
      const line = lines[index] ?? ''
      const match = word.exec(line)
      if (!match) continue
      items.push({
        path: file.relativePath,
        line: index + 1,
        column: match.index + 1,
        kind: isDefinitionLine(line, symbol) ? 'definition' : 'reference',
        name: symbol,
        text: line.trim(),
      })
    }
    if (items.length >= maxResults) break
  }
  return items
}

async function matchingCodeFiles(context: ToolUseContext, rootPath: string, pattern: string, maxFiles: number) {
  const files = await listWorkspaceFiles(context, rootPath, { maxFiles, includeHidden: false })
  const extensions = extensionsFromBracePattern(pattern)
  if (extensions.length) return files.filter(file => extensions.some(extension => file.relativePath.endsWith(`.${extension}`)))
  const matcher = globToRegExp(pattern)
  return files.filter(file => matcher.test(file.relativePath))
}

function parseTscDiagnostics(text: string): LspItem[] {
  const items: LspItem[] = []
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+([^:]+):\s+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    items.push({
      path: match[1] ?? '',
      line: Number(match[2] ?? 1),
      column: Number(match[3] ?? 1),
      kind: match[4] ?? 'diagnostic',
      text: match[5] ?? '',
    })
  }
  return items
}

function symbolPattern(): RegExp {
  return /\b(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+(?<name>[A-Za-z_$][A-Za-z0-9_$]*)/
}

function isDefinitionLine(line: string, symbol: string): boolean {
  return new RegExp(`\\b(?:function|class|const|let|var|interface|type)\\s+${escapeRegExp(symbol)}\\b`).test(line)
}

function extensionsFromBracePattern(pattern: string): string[] {
  const match = /\.\{([^}]+)\}$/.exec(pattern)
  if (!match?.[1]) return []
  return match[1].split(',').map(item => item.trim()).filter(Boolean)
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
}
