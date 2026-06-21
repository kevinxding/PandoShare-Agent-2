import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LicenseAudit } from './LicenseAudit.js'
import { SecretScanner } from './SecretScanner.js'
import { permissionThreatBoundaries } from './CleanRoomPolicy.js'
import type { SecurityAcceptanceReport } from './SecurityTypes.js'

export async function buildSecurityAcceptanceReport(workspaceRoot: string): Promise<SecurityAcceptanceReport> {
  const secretScan = await new SecretScanner(workspaceRoot).scan()
  const licenseAudit = await new LicenseAudit(workspaceRoot).run()
  const blockers = [...licenseAudit.blockers]
  return { ok: secretScan.findingCount === 0 && blockers.length === 0, generatedAtMs: Date.now(), secretScan, licenseAudit, boundaries: permissionThreatBoundaries(), blockers }
}

export async function writeSecurityAcceptanceReport(workspaceRoot: string, outDir = 'docs/security'): Promise<SecurityAcceptanceReport> {
  const report = await buildSecurityAcceptanceReport(workspaceRoot)
  const dir = resolve(workspaceRoot, outDir)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'generated-security-acceptance-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  await writeFile(resolve(dir, 'security-acceptance-report.md'), renderSecurityReport(report), 'utf8')
  return report
}

export function renderSecurityReport(report: SecurityAcceptanceReport): string {
  return [
    '# Security Acceptance Report', '',
    'Status: ' + (report.ok ? 'passed' : 'blocked baseline'), '',
    '## Secret Scan', '',
    '- Scanned files: ' + report.secretScan.scannedFiles,
    '- Findings: ' + report.secretScan.findingCount, '',
    '## License Audit', '',
    '- Package: ' + report.licenseAudit.packageName,
    '- Private package: ' + report.licenseAudit.privatePackage,
    '- License status: ' + report.licenseAudit.licenseStatus, '',
    '## Blockers', '',
    ...(report.blockers.length ? report.blockers.map(item => '- ' + item) : ['- None']), '',
    '## Boundaries', '',
    ...report.boundaries.map(item => '- ' + item), '',
  ].join('\n')
}
