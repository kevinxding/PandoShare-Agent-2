export const AUTOMATION_TRIGGERS = ['manual', 'interval', 'heartbeat', 'gateway', 'file_change'] as const
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number]

export const SUPPORTED_AUTOMATION_TRIGGERS = ['manual', 'interval', 'heartbeat'] as const
export type SupportedAutomationTrigger = typeof SUPPORTED_AUTOMATION_TRIGGERS[number]

export const WORKSPACE_ISOLATION_MODES = ['none', 'temp_copy', 'git_worktree'] as const
export type WorkspaceIsolationModeV3 = typeof WORKSPACE_ISOLATION_MODES[number]

export const SUBAGENT_ROLES = ['builder', 'planner', 'verifier', 'reviewer', 'gui-operator', 'gateway-operator'] as const
export type SubAgentRole = typeof SUBAGENT_ROLES[number]

export const VERIFIER_NODE_TYPES = ['command', 'file', 'replay', 'model_mock', 'custom'] as const
export type VerifierNodeType = typeof VERIFIER_NODE_TYPES[number]

export type VerifierIdentity = {
  verifierId: string
  family: string
}

export type BaseVerifierNodeSpec = {
  nodeId: string
  dependsOn?: readonly string[]
  verifierIdentity?: VerifierIdentity
}

export type CommandVerifierNodeSpec = BaseVerifierNodeSpec & {
  type: 'command'
  command: string
  cwd?: string
  timeoutMs?: number
}

export type FileVerifierNodeSpec = BaseVerifierNodeSpec & {
  type: 'file'
  path: string
  exists?: boolean
  contains?: string
}

export type ReplayVerifierNodeSpec = BaseVerifierNodeSpec & {
  type: 'replay'
  replayId: string
  expectedStatus?: 'passed' | 'failed'
}

export type ModelMockVerifierNodeSpec = BaseVerifierNodeSpec & {
  type: 'model_mock'
  mockOutput: string
  expectedContains?: string
}

export type CustomVerifierNodeSpec = BaseVerifierNodeSpec & {
  type: 'custom'
  name: string
  expectedOk?: boolean
}

export type VerifierNodeSpec =
  | CommandVerifierNodeSpec
  | FileVerifierNodeSpec
  | ReplayVerifierNodeSpec
  | ModelMockVerifierNodeSpec
  | CustomVerifierNodeSpec

export type VerificationPlanV3 = {
  graphId?: string
  nodes: readonly VerifierNodeSpec[]
  requiredNodeIds?: readonly string[]
  allowSameFamilyVerifier?: boolean
}

export type LoopSubAgentSpec = {
  agentId: string
  role: SubAgentRole
  family: string
  permissionProfile?: string
}

export type SkillPolicyV3 = {
  enabled: boolean
  writeCandidates: boolean
  tags?: readonly string[]
}

export type ConnectorPolicyV3 = {
  requirePlan: boolean
  allowMcp: boolean
  allowGateway: boolean
  allowFile: boolean
  allowGui: boolean
}

export type StatePolicyV3 = {
  journal: 'durable' | 'jsonl'
  replayReadable: boolean
  jsonlPath?: string
}

export type BudgetPolicyV3 = {
  maxTicks?: number
  maxVerifierNodes?: number
  maxSubagents?: number
  maxRuntimeMs?: number
}

export type HumanGatePolicyV3 = {
  approvalMode: 'none' | 'manual'
  requireBeforeUnsafeConnector: boolean
  requireOnVerifierFailure: boolean
}

export type LoopSpecV3 = {
  loopId: string
  goalId: string
  objective: string
  successCriteria: readonly string[]
  verificationPlan: VerificationPlanV3
  automationTrigger: AutomationTrigger
  automationIntervalMs?: number
  heartbeatIntervalMs?: number
  workspaceIsolation: WorkspaceIsolationModeV3
  subagents: readonly LoopSubAgentSpec[]
  skillPolicy: SkillPolicyV3
  connectorPolicy: ConnectorPolicyV3
  statePolicy: StatePolicyV3
  budgetPolicy: BudgetPolicyV3
  humanGatePolicy: HumanGatePolicyV3
}

export type LoopSpecV3ValidationResult =
  | { ok: true; spec: LoopSpecV3; errors: [] }
  | { ok: false; errors: string[] }

export function isSupportedAutomationTrigger(trigger: AutomationTrigger): trigger is SupportedAutomationTrigger {
  return includesValue(SUPPORTED_AUTOMATION_TRIGGERS, trigger)
}

export function validateLoopSpecV3(input: unknown): LoopSpecV3ValidationResult {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['spec must be an object'] }

  requireNonEmptyString(input.loopId, 'loopId', errors)
  requireNonEmptyString(input.goalId, 'goalId', errors)
  requireNonEmptyString(input.objective, 'objective', errors)
  requireStringArray(input.successCriteria, 'successCriteria', errors, { nonEmpty: true })

  if (!includesValue(AUTOMATION_TRIGGERS, input.automationTrigger)) {
    errors.push('automationTrigger must be manual, interval, heartbeat, gateway, or file_change')
  }
  if (input.automationIntervalMs !== undefined && !isPositiveNumber(input.automationIntervalMs)) {
    errors.push('automationIntervalMs must be a positive number when provided')
  }
  if (input.heartbeatIntervalMs !== undefined && !isPositiveNumber(input.heartbeatIntervalMs)) {
    errors.push('heartbeatIntervalMs must be a positive number when provided')
  }
  if (!includesValue(WORKSPACE_ISOLATION_MODES, input.workspaceIsolation)) {
    errors.push('workspaceIsolation must be none, temp_copy, or git_worktree')
  }

  validateVerificationPlan(input.verificationPlan, errors)
  validateSubagents(input.subagents, input.budgetPolicy, errors)
  validatePolicyObjects(input, errors)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, spec: input as LoopSpecV3, errors: [] }
}

export function assertValidLoopSpecV3(input: unknown): LoopSpecV3 {
  const result = validateLoopSpecV3(input)
  if (!result.ok) throw new Error(`Invalid LoopSpecV3: ${result.errors.join('; ')}`)
  return result.spec
}

function validateVerificationPlan(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('verificationPlan must be an object')
    return
  }
  if (!Array.isArray(value.nodes)) {
    errors.push('verificationPlan.nodes must be an array')
    return
  }
  if (value.nodes.length === 0) errors.push('verificationPlan.nodes must contain at least one node')
  const nodeIds = new Set<string>()
  for (const [index, rawNode] of value.nodes.entries()) {
    if (!isRecord(rawNode)) {
      errors.push(`verificationPlan.nodes[${index}] must be an object`)
      continue
    }
    if (!requireNonEmptyString(rawNode.nodeId, `verificationPlan.nodes[${index}].nodeId`, errors)) continue
    if (nodeIds.has(rawNode.nodeId)) errors.push(`duplicate verifier nodeId: ${rawNode.nodeId}`)
    nodeIds.add(rawNode.nodeId)
    if (!includesValue(VERIFIER_NODE_TYPES, rawNode.type)) {
      errors.push(`verificationPlan.nodes[${index}].type must be command, file, replay, model_mock, or custom`)
      continue
    }
    validateVerifierNode(rawNode, index, errors)
  }
  for (const rawNode of value.nodes) {
    if (!isRecord(rawNode) || typeof rawNode.nodeId !== 'string') continue
    if (rawNode.dependsOn !== undefined) {
      if (!Array.isArray(rawNode.dependsOn) || !rawNode.dependsOn.every(item => typeof item === 'string' && item.length > 0)) {
        errors.push(`verificationPlan node ${rawNode.nodeId} dependsOn must be an array of node ids`)
      } else {
        for (const dependency of rawNode.dependsOn) {
          if (!nodeIds.has(dependency)) errors.push(`verificationPlan node ${rawNode.nodeId} depends on missing node ${dependency}`)
        }
      }
    }
  }
  if (Array.isArray(value.requiredNodeIds)) {
    for (const nodeId of value.requiredNodeIds) {
      if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) errors.push(`requiredNodeIds contains missing node ${String(nodeId)}`)
    }
  } else if (value.requiredNodeIds !== undefined) {
    errors.push('verificationPlan.requiredNodeIds must be an array when provided')
  }
}

function validateVerifierNode(node: Record<string, unknown>, index: number, errors: string[]): void {
  if (node.verifierIdentity !== undefined) {
    if (!isRecord(node.verifierIdentity)) errors.push(`verificationPlan.nodes[${index}].verifierIdentity must be an object`)
    else {
      requireNonEmptyString(node.verifierIdentity.verifierId, `verificationPlan.nodes[${index}].verifierIdentity.verifierId`, errors)
      requireNonEmptyString(node.verifierIdentity.family, `verificationPlan.nodes[${index}].verifierIdentity.family`, errors)
    }
  }
  switch (node.type) {
    case 'command':
      requireNonEmptyString(node.command, `verificationPlan.nodes[${index}].command`, errors)
      if (node.timeoutMs !== undefined && !isPositiveNumber(node.timeoutMs)) errors.push(`verificationPlan.nodes[${index}].timeoutMs must be positive`)
      break
    case 'file':
      requireNonEmptyString(node.path, `verificationPlan.nodes[${index}].path`, errors)
      break
    case 'replay':
      requireNonEmptyString(node.replayId, `verificationPlan.nodes[${index}].replayId`, errors)
      break
    case 'model_mock':
      requireNonEmptyString(node.mockOutput, `verificationPlan.nodes[${index}].mockOutput`, errors)
      break
    case 'custom':
      requireNonEmptyString(node.name, `verificationPlan.nodes[${index}].name`, errors)
      break
  }
}

function validateSubagents(value: unknown, budgetPolicy: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('subagents must be an array')
    return
  }
  const ids = new Set<string>()
  for (const [index, subagent] of value.entries()) {
    if (!isRecord(subagent)) {
      errors.push(`subagents[${index}] must be an object`)
      continue
    }
    if (requireNonEmptyString(subagent.agentId, `subagents[${index}].agentId`, errors)) {
      if (ids.has(subagent.agentId)) errors.push(`duplicate subagent agentId: ${subagent.agentId}`)
      ids.add(subagent.agentId)
    }
    if (!includesValue(SUBAGENT_ROLES, subagent.role)) errors.push(`subagents[${index}].role is invalid`)
    requireNonEmptyString(subagent.family, `subagents[${index}].family`, errors)
  }
  if (isRecord(budgetPolicy) && typeof budgetPolicy.maxSubagents === 'number' && value.length > budgetPolicy.maxSubagents) {
    errors.push(`subagents exceeds budgetPolicy.maxSubagents=${budgetPolicy.maxSubagents}`)
  }
}

function validatePolicyObjects(input: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(input.skillPolicy)) errors.push('skillPolicy must be an object')
  else {
    requireBoolean(input.skillPolicy.enabled, 'skillPolicy.enabled', errors)
    requireBoolean(input.skillPolicy.writeCandidates, 'skillPolicy.writeCandidates', errors)
    if (input.skillPolicy.tags !== undefined) requireStringArray(input.skillPolicy.tags, 'skillPolicy.tags', errors)
  }
  if (!isRecord(input.connectorPolicy)) errors.push('connectorPolicy must be an object')
  else {
    for (const key of ['requirePlan', 'allowMcp', 'allowGateway', 'allowFile', 'allowGui']) requireBoolean(input.connectorPolicy[key], `connectorPolicy.${key}`, errors)
  }
  if (!isRecord(input.statePolicy)) errors.push('statePolicy must be an object')
  else {
    if (input.statePolicy.journal !== 'durable' && input.statePolicy.journal !== 'jsonl') errors.push('statePolicy.journal must be durable or jsonl')
    requireBoolean(input.statePolicy.replayReadable, 'statePolicy.replayReadable', errors)
  }
  if (!isRecord(input.budgetPolicy)) errors.push('budgetPolicy must be an object')
  else {
    for (const key of ['maxTicks', 'maxVerifierNodes', 'maxSubagents', 'maxRuntimeMs']) {
      const value = input.budgetPolicy[key]
      if (value !== undefined && !isPositiveNumber(value)) errors.push(`budgetPolicy.${key} must be positive when provided`)
    }
  }
  if (!isRecord(input.humanGatePolicy)) errors.push('humanGatePolicy must be an object')
  else {
    if (input.humanGatePolicy.approvalMode !== 'none' && input.humanGatePolicy.approvalMode !== 'manual') errors.push('humanGatePolicy.approvalMode must be none or manual')
    requireBoolean(input.humanGatePolicy.requireBeforeUnsafeConnector, 'humanGatePolicy.requireBeforeUnsafeConnector', errors)
    requireBoolean(input.humanGatePolicy.requireOnVerifierFailure, 'humanGatePolicy.requireOnVerifierFailure', errors)
  }
}

function requireNonEmptyString(value: unknown, name: string, errors: string[]): value is string {
  if (typeof value === 'string' && value.trim().length > 0) return true
  errors.push(`${name} must be a non-empty string`)
  return false
}

function requireStringArray(value: unknown, name: string, errors: string[], options: { nonEmpty?: boolean } = {}): value is readonly string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim().length > 0)) {
    errors.push(`${name} must be an array of non-empty strings`)
    return false
  }
  if (options.nonEmpty && value.length === 0) {
    errors.push(`${name} must not be empty`)
    return false
  }
  return true
}

function requireBoolean(value: unknown, name: string, errors: string[]): value is boolean {
  if (typeof value === 'boolean') return true
  errors.push(`${name} must be a boolean`)
  return false
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function includesValue<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}
