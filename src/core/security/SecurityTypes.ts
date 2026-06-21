export type SecretFinding = { file: string; line: number; kind: string; preview: string }
export type SecretScanReport = { scannedFiles: number; findingCount: number; findings: SecretFinding[] }
export type LicenseEntry = { name: string; version?: string; license: string; scope: 'dependency' | 'devDependency' }
export type LicenseAuditReport = { packageName: string; privatePackage: boolean; licenseStatus: 'missing' | 'declared'; blockers: string[]; dependencies: LicenseEntry[]; provenance: string[] }
export type SecurityAcceptanceReport = { ok: boolean; generatedAtMs: number; secretScan: SecretScanReport; licenseAudit: LicenseAuditReport; boundaries: string[]; blockers: string[] }
