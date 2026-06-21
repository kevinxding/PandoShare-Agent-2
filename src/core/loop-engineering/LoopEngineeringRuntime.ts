import type { DurableRuntime } from '../durable/index.js'
import type { MemoryStore } from '../memory/index.js'
import { AutomationScheduler, type AutomationTaskPlan, type AutomationTickResult } from './AutomationScheduler.js'
import { createConnectorPlan, type ConnectorPlan, type ConnectorRequirement } from './ConnectorPlan.js'
import { assertValidLoopSpecV3, type LoopSpecV3 } from './LoopSpecV3.js'
import { LoopStateJournal } from './LoopStateJournal.js'
import { SkillCandidateWriter, type SkillCandidateInput, type SkillCandidateWriteResult } from './SkillCandidateWriter.js'
import { SubAgentRegistry, type SubAgentAssignmentResult } from './SubAgentRegistry.js'
import { VerifierGraph, type VerificationGraphResult, type VerifierGraphContext } from './VerifierGraph.js'

export type LoopEngineeringRuntimeOptions = {
  workspaceRoot: string
  workspaceId?: string
  durable?: DurableRuntime
  memoryStore?: MemoryStore
  jsonlPath?: string
}

export class LoopEngineeringRuntime {
  readonly journal: LoopStateJournal
  readonly scheduler: AutomationScheduler
  readonly verifierGraph = new VerifierGraph()
  readonly subAgentRegistry = new SubAgentRegistry()
  readonly skillCandidateWriter: SkillCandidateWriter

  constructor(options: LoopEngineeringRuntimeOptions) {
    this.journal = new LoopStateJournal({
      workspaceRoot: options.workspaceRoot,
      workspaceId: options.workspaceId,
      durable: options.durable,
      jsonlPath: options.jsonlPath,
    })
    this.scheduler = new AutomationScheduler({ journal: this.journal })
    this.skillCandidateWriter = new SkillCandidateWriter(options.memoryStore)
  }

  async recordSpec(spec: LoopSpecV3): Promise<LoopSpecV3> {
    const validSpec = assertValidLoopSpecV3(spec)
    await this.journal.recordSpec(validSpec)
    return validSpec
  }

  async tick(input: { spec: LoopSpecV3; tasks?: readonly AutomationTaskPlan[]; manual?: boolean; nowMs?: number }): Promise<AutomationTickResult> {
    const spec = assertValidLoopSpecV3(input.spec)
    return this.scheduler.tick({ ...input, spec })
  }

  async runVerifierGraph(input: { spec: LoopSpecV3; context?: VerifierGraphContext }): Promise<VerificationGraphResult> {
    const spec = assertValidLoopSpecV3(input.spec)
    const result = await this.verifierGraph.run(spec.verificationPlan, {
      builderFamilies: spec.subagents.filter(agent => agent.role === 'builder').map(agent => agent.family),
      allowSameFamilyVerifier: spec.verificationPlan.allowSameFamilyVerifier,
      ...input.context,
    })
    await this.journal.recordVerifierGraph({ loopId: spec.loopId, goalId: spec.goalId, result })
    return result
  }

  async assignSubAgents(spec: LoopSpecV3): Promise<SubAgentAssignmentResult> {
    const validSpec = assertValidLoopSpecV3(spec)
    const result = this.subAgentRegistry.assign({
      subagents: validSpec.subagents,
      allowVerifierSameFamily: validSpec.verificationPlan.allowSameFamilyVerifier,
    })
    await this.journal.recordSubAgentAssignment({ loopId: validSpec.loopId, goalId: validSpec.goalId, result })
    return result
  }

  async writeSkillCandidate(spec: LoopSpecV3, candidate: Omit<SkillCandidateInput, 'goalId' | 'loopId'>): Promise<SkillCandidateWriteResult> {
    const validSpec = assertValidLoopSpecV3(spec)
    if (!validSpec.skillPolicy.enabled || !validSpec.skillPolicy.writeCandidates) {
      const skipped: SkillCandidateWriteResult = { written: false, skillId: candidate.skillId, reason: 'skill_policy_disabled' }
      await this.journal.recordSkillCandidate({ loopId: validSpec.loopId, goalId: validSpec.goalId, result: skipped })
      return skipped
    }
    const result = await this.skillCandidateWriter.writeCandidate({
      ...candidate,
      goalId: validSpec.goalId,
      loopId: validSpec.loopId,
      tags: [...(validSpec.skillPolicy.tags ?? []), ...(candidate.tags ?? [])],
    })
    await this.journal.recordSkillCandidate({ loopId: validSpec.loopId, goalId: validSpec.goalId, result })
    return result
  }

  createConnectorPlan(input: { spec: LoopSpecV3; requirements: readonly ConnectorRequirement[] }): ConnectorPlan {
    const spec = assertValidLoopSpecV3(input.spec)
    return createConnectorPlan({ loopId: spec.loopId, goalId: spec.goalId, requirements: input.requirements })
  }
}

export function createLoopEngineeringRuntime(options: LoopEngineeringRuntimeOptions): LoopEngineeringRuntime {
  return new LoopEngineeringRuntime(options)
}