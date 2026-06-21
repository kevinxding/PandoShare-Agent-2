import type { PermissionProfile } from './PermissionProfile.js'

export type PermissionInvariantResult = {
  ok: boolean
  violations: string[]
}

export function validatePermissionProfile(profile: PermissionProfile): PermissionInvariantResult {
  const violations: string[] = []

  if (!profile.allowWorkspaceWrite && profile.sandboxMode === 'workspace-write') {
    violations.push('workspace-write sandbox requires allowWorkspaceWrite=true')
  }
  if (profile.allowExternalWrite && profile.sandboxMode !== 'full-access') {
    violations.push('allowExternalWrite requires full-access sandbox')
  }
  if (profile.name === 'readonly' && (profile.allowWorkspaceWrite || profile.allowExternalWrite || profile.guiMode !== 'none' || profile.gatewayMode !== 'none')) {
    violations.push('readonly profile must not allow writes, GUI, or gateway actions')
  }
  if (profile.name === 'verifier' && (profile.allowWorkspaceWrite || profile.allowExternalWrite)) {
    violations.push('verifier profile must be read-only for file and external effects')
  }
  if (profile.guiMode === 'write_approval' && profile.approvalPolicy === 'never') {
    violations.push('GUI write approval mode requires a prompting approval policy')
  }
  if (profile.gatewayMode === 'write_approval' && profile.approvalPolicy === 'never') {
    violations.push('gateway write approval mode requires a prompting approval policy')
  }

  return { ok: violations.length === 0, violations }
}

export function assertPermissionProfile(profile: PermissionProfile): void {
  const result = validatePermissionProfile(profile)
  if (!result.ok) {
    throw new Error(`Invalid permission profile ${profile.name}: ${result.violations.join('; ')}`)
  }
}
