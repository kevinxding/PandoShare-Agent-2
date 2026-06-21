import type { SandboxAuditRecord } from '../sandbox/index.js'

export type PermissionAuditRecord = SandboxAuditRecord

export class PermissionAudit {
  private readonly records: PermissionAuditRecord[] = []

  append(record: PermissionAuditRecord): PermissionAuditRecord {
    this.records.push(record)
    return record
  }

  list(): PermissionAuditRecord[] {
    return [...this.records]
  }

  clear(): void {
    this.records.length = 0
  }
}
