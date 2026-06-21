export type ConnectorKind = 'mcp' | 'gateway' | 'file' | 'gui'
export type ConnectorAccess = 'read' | 'write' | 'deliver' | 'observe'

export type ConnectorRequirement = {
  connectorId: string
  kind: ConnectorKind
  access: ConnectorAccess
  purpose: string
  requiredCapability: string
}

export type ConnectorRisk = {
  connectorId: string
  level: 'low' | 'medium' | 'high'
  reason: string
  requiresHumanGate: boolean
}

export type ConnectorPlan = {
  planId: string
  loopId: string
  goalId?: string
  requirements: readonly ConnectorRequirement[]
  risks: readonly ConnectorRisk[]
  executionAllowed: false
  summary: string
}

export function createConnectorPlan(input: { loopId: string; goalId?: string; requirements: readonly ConnectorRequirement[] }): ConnectorPlan {
  const risks = input.requirements.map(requirement => assessConnectorRisk(requirement))
  return {
    planId: `connector_plan_${safeId(input.loopId)}`,
    loopId: input.loopId,
    goalId: input.goalId,
    requirements: input.requirements,
    risks,
    executionAllowed: false,
    summary: `Connector plan only; ${input.requirements.length} requirement(s), ${risks.filter(risk => risk.requiresHumanGate).length} human gate(s) required.`,
  }
}

export function assessConnectorRisk(requirement: ConnectorRequirement): ConnectorRisk {
  if (requirement.access === 'write' || requirement.access === 'deliver') {
    return {
      connectorId: requirement.connectorId,
      level: requirement.kind === 'file' ? 'medium' : 'high',
      reason: `${requirement.kind} ${requirement.access} requires explicit approval before execution`,
      requiresHumanGate: true,
    }
  }
  if (requirement.kind === 'gui' || requirement.kind === 'gateway') {
    return {
      connectorId: requirement.connectorId,
      level: 'medium',
      reason: `${requirement.kind} observation can expose external state; keep evidence bounded`,
      requiresHumanGate: false,
    }
  }
  return {
    connectorId: requirement.connectorId,
    level: 'low',
    reason: `${requirement.kind} ${requirement.access} is plan-only in Loop Engineering V3`,
    requiresHumanGate: false,
  }
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_') || 'loop'
}