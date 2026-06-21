import { getPermissionProfile, type PermissionProfile, type PermissionProfileName } from '../permissions-v2/index.js'
import { SUBAGENT_ROLES, type LoopSubAgentSpec, type SubAgentRole } from './LoopSpecV3.js'

export type SubAgentProfile = {
  role: SubAgentRole
  defaultPermissionProfile: PermissionProfileName
  description: string
}

export const SUBAGENT_PROFILES: Record<SubAgentRole, SubAgentProfile> = {
  builder: {
    role: 'builder',
    defaultPermissionProfile: 'loop_worker',
    description: 'Implements scoped code or content changes in an isolated workspace.',
  },
  planner: {
    role: 'planner',
    defaultPermissionProfile: 'plan',
    description: 'Breaks objectives into tasks and acceptance criteria without writes.',
  },
  verifier: {
    role: 'verifier',
    defaultPermissionProfile: 'verifier',
    description: 'Runs independent verification and reports evidence.',
  },
  reviewer: {
    role: 'reviewer',
    defaultPermissionProfile: 'readonly',
    description: 'Reviews behavior, risk, and evidence without writes.',
  },
  'gui-operator': {
    role: 'gui-operator',
    defaultPermissionProfile: 'gui_write_approval',
    description: 'Operates GUI surfaces after approval.',
  },
  'gateway-operator': {
    role: 'gateway-operator',
    defaultPermissionProfile: 'gateway_operator',
    description: 'Handles gateway delivery with approval before writes.',
  },
}

export type BoundSubAgent = LoopSubAgentSpec & {
  profile: SubAgentProfile
  permission: PermissionProfile
}

export type SubAgentAssignmentResult = {
  ok: boolean
  assignments: BoundSubAgent[]
  failureReasons: string[]
}

export class SubAgentRegistry {
  profile(role: SubAgentRole): SubAgentProfile {
    return SUBAGENT_PROFILES[role]
  }

  assign(input: { subagents: readonly LoopSubAgentSpec[]; allowVerifierSameFamily?: boolean }): SubAgentAssignmentResult {
    const failureReasons: string[] = []
    const assignments: BoundSubAgent[] = []
    const builderFamilies = new Set(input.subagents.filter(agent => agent.role === 'builder').map(agent => agent.family))
    const ids = new Set<string>()

    for (const subagent of input.subagents) {
      if (ids.has(subagent.agentId)) failureReasons.push(`duplicate subagent agentId: ${subagent.agentId}`)
      ids.add(subagent.agentId)
      if (!SUBAGENT_ROLES.includes(subagent.role)) {
        failureReasons.push(`unsupported subagent role: ${String(subagent.role)}`)
        continue
      }
      if (subagent.role === 'verifier' && !input.allowVerifierSameFamily && builderFamilies.has(subagent.family)) {
        failureReasons.push(`verifier ${subagent.agentId} cannot share builder family ${subagent.family}`)
      }
      const profile = this.profile(subagent.role)
      const permissionName = subagent.permissionProfile ?? profile.defaultPermissionProfile
      if (!isPermissionProfileName(permissionName)) {
        failureReasons.push(`subagent ${subagent.agentId} has unknown permission profile ${permissionName}`)
        continue
      }
      assignments.push({ ...subagent, profile, permission: getPermissionProfile(permissionName) })
    }

    return { ok: failureReasons.length === 0, assignments, failureReasons }
  }
}

function isPermissionProfileName(value: string): value is PermissionProfileName {
  return ['readonly', 'plan', 'build', 'full_access', 'gui_readonly', 'gui_write_approval', 'loop_worker', 'gateway_operator', 'verifier'].includes(value)
}