import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { SecretFinding, SecretScanReport } from './SecurityTypes.js'

type Pattern = { kind: string; pattern: RegExp }

const PATTERNS: Pattern[] = [
  { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { kind: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._-]{12,}/gi },
  { kind: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'password', pattern: /\b(password|passwd|pwd)\s*[:=]\s*['"]?[^'"\s]{8,}/gi },
  { kind: 'webhook_secret', pattern: /\b(webhook|secret|cookie|authorization|apiKey|token)\s*[:=]\s*['"]?[^'"\s]{12,}/gi },
]

const DEFAULT_DIRS = ['src', 'scripts', 'docs', 'package.json', 'web']
const IGNORE_PARTS = new Set(['node_modules', 'dist', '.git', '.pandoshare'])

export class SecretScanner {
  constructor(private readonly workspaceRoot: string, private readonly allowlist: readonly string[] = []) {}

  async scan(paths: readonly string[] = DEFAULT_DIRS): Promise<SecretScanReport> {
    const files: string[] = []
    for (const item of paths) await this.collect(resolve(this.workspaceRoot, item), files)
    const findings: SecretFinding[] = []
    for (const file of files) {
      const rel = toRel(this.workspaceRoot, file)
      if (this.isAllowed(rel)) continue
      const content = await readFile(file, 'utf8')
      const lines = content.split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        if (isFixtureSafe(rel, line)) continue
        for (const pattern of PATTERNS) {
          pattern.pattern.lastIndex = 0
          if (pattern.pattern.test(line)) findings.push({ file: rel, line: index + 1, kind: pattern.kind, preview: redactLine(line) })
        }
      }
    }
    return { scannedFiles: files.length, findingCount: findings.length, findings }
  }

  private async collect(target: string, files: string[]): Promise<void> {
    let info
    try { info = await stat(target) } catch { return }
    if (info.isDirectory()) {
      const parts = target.split(/[\\/]/)
      if (parts.some(part => IGNORE_PARTS.has(part))) return
      for (const name of await readdir(target)) await this.collect(join(target, name), files)
      return
    }
    if (info.isFile() && isTextFile(target)) files.push(target)
  }

  private isAllowed(rel: string): boolean {
    return this.allowlist.some(item => rel === item || rel.includes(item))
  }
}

export function redactLine(line: string): string {
  return line
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/(password|passwd|pwd|webhook|secret|cookie|authorization|apiKey|token)(\s*[:=]\s*)['"]?[^'"\s]+/gi, '$1$2[REDACTED]')
}

function isTextFile(file: string): boolean {
  return /\.(ts|tsx|js|mjs|json|md|yml|yaml|txt|cjs)$/i.test(file) || /package\.json$/i.test(file)
}

function isFixtureSafe(rel: string, line: string): boolean {
  return rel.includes('docs/security') || rel.includes('scripts/security') || /fixture|example|placeholder|redacted/i.test(line)
}

function toRel(root: string, file: string): string { return relative(root, file).replace(/\\/g, '/') }
