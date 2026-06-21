import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LicenseAuditReport, LicenseEntry } from './SecurityTypes.js'

export class LicenseAudit {
  constructor(private readonly workspaceRoot: string) {}

  async run(): Promise<LicenseAuditReport> {
    const pkg = JSON.parse(await readFile(resolve(this.workspaceRoot, 'package.json'), 'utf8'))
    const deps = collect(pkg.dependencies ?? {}, 'dependency').concat(collect(pkg.devDependencies ?? {}, 'devDependency'))
    const hasLicense = await fileExists(resolve(this.workspaceRoot, 'LICENSE')) || typeof pkg.license === 'string'
    const blockers: string[] = []
    if (!hasLicense) blockers.push('LICENSE missing: owner must choose MIT, Apache-2.0, or another license before public release claims.')
    if (pkg.private === true) blockers.push('not publishable until owner changes private flag')
    return {
      packageName: String(pkg.name ?? 'unknown'),
      privatePackage: pkg.private === true,
      licenseStatus: hasLicense ? 'declared' : 'missing',
      blockers,
      dependencies: deps,
      provenance: [
        'OpenCode MIT: ideas may be studied; copied code must preserve license.',
        'Codex Apache-2.0: ideas may be studied; copied code must preserve NOTICE obligations.',
        'Hermes MIT: ideas may be studied; copied code must preserve license.',
        'Claude Code research: clean-room architecture study only; do not copy proprietary source, prompts, or text.',
      ],
    }
  }
}

function collect(deps: Record<string, string>, scope: LicenseEntry['scope']): LicenseEntry[] {
  return Object.entries(deps).map(([name, version]) => ({ name, version, license: 'unknown', scope }))
}

async function fileExists(file: string): Promise<boolean> {
  try { await stat(file); return true } catch { return false }
}
