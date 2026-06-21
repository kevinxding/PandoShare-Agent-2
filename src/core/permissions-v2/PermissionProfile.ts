import type { ApprovalPolicyName } from './ApprovalPolicy.js'
import type { SandboxMode } from '../sandbox/index.js'

export type PermissionProfileName =
  | 'readonly'
  | 'plan'
  | 'build'
  | 'full_access'
  | 'gui_readonly'
  | 'gui_write_approval'
  | 'loop_worker'
  | 'gateway_operator'
  | 'verifier'

export type PermissionProfile = {
  name: PermissionProfileName
  sandboxMode: SandboxMode
  approvalPolicy: ApprovalPolicyName
  allowWorkspaceWrite: boolean
  allowExternalWrite: boolean
  guiMode: 'none' | 'read' | 'write_approval'
  gatewayMode: 'none' | 'read' | 'write_approval'
}

export const PERMISSION_PROFILES: Record<PermissionProfileName, PermissionProfile> = {
  readonly: {
    name: 'readonly',
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    allowWorkspaceWrite: false,
    allowExternalWrite: false,
    guiMode: 'none',
    gatewayMode: 'none',
  },
  plan: {
    name: 'plan',
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    allowWorkspaceWrite: false,
    allowExternalWrite: false,
    guiMode: 'none',
    gatewayMode: 'read',
  },
  build: {
    name: 'build',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    allowWorkspaceWrite: true,
    allowExternalWrite: false,
    guiMode: 'none',
    gatewayMode: 'read',
  },
  full_access: {
    name: 'full_access',
    sandboxMode: 'full-access',
    approvalPolicy: 'on-request',
    allowWorkspaceWrite: true,
    allowExternalWrite: true,
    guiMode: 'write_approval',
    gatewayMode: 'write_approval',
  },
  gui_readonly: {
    name: 'gui_readonly',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    allowWorkspaceWrite: true,
    allowExternalWrite: false,
    guiMode: 'read',
    gatewayMode: 'read',
  },
  gui_write_approval: {
    name: 'gui_write_approval',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    allowWorkspaceWrite: true,
    allowExternalWrite: false,
    guiMode: 'write_approval',
    gatewayMode: 'read',
  },
  loop_worker: {
    name: 'loop_worker',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'granular',
    allowWorkspaceWrite: true,
    allowExternalWrite: false,
    guiMode: 'none',
    gatewayMode: 'read',
  },
  gateway_operator: {
    name: 'gateway_operator',
    sandboxMode: 'read-only',
    approvalPolicy: 'on-request',
    allowWorkspaceWrite: false,
    allowExternalWrite: false,
    guiMode: 'none',
    gatewayMode: 'write_approval',
  },
  verifier: {
    name: 'verifier',
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    allowWorkspaceWrite: false,
    allowExternalWrite: false,
    guiMode: 'read',
    gatewayMode: 'read',
  },
}

export const PERMISSION_PROFILE_NAMES = Object.keys(PERMISSION_PROFILES) as PermissionProfileName[]

export function getPermissionProfile(name: PermissionProfileName): PermissionProfile {
  return PERMISSION_PROFILES[name]
}
