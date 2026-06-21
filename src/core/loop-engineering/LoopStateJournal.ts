import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { DurableRuntime } from '../durable/index.js'
import type { LoopSpecV3 } from './LoopSpecV3.js'
import type { AutomationTickResult } from './AutomationScheduler.js'
import type { VerificationGraphResult } from './VerifierGraph.js'
import type { SubAgentAssignmentResult } from './SubAgentRegistry.js'
import type { SkillCandidateWriteResult } from './SkillCandidateWriter.js'

export const LOOP_ENGINEERING_EVENT_TYPES = {
  specRecorded: 'loop_engineering_spec_recorded',
  automationTick: 'loop_engineering_automation_tick',
  verifierGraph: 'loop_engineering_verifier_graph',
  subagentAssignment: 'loop_engineering_subagent_assignment',
  skillCandidate: 'loop_engineering_skill_candidate',
} as const

export type LoopEngineeringEventType = typeof LOOP_ENGINEERING_EVENT_TYPES[keyof typeof LOOP_ENGINEERING_EVENT_TYPES]

export type LoopEngineeringJournalRecord = {
  eventType: LoopEngineeringEventType
  workspaceId: string
  loopId: string
  goalId?: string
  createdAtMs: number
  payload: unknown
}

export type LoopStateJournalOptions = {
  workspaceRoot: string
  workspaceId?: string
  durable?: DurableRuntime
  jsonlPath?: string
}

export class LoopStateJournal {
  private readonly workspaceRoot: string
  private readonly workspaceId: string
  private readonly durable?: DurableRuntime
  private readonly path: string

  constructor(options: LoopStateJournalOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot)
    this.workspaceId = options.workspaceId ?? 'default'
    this.durable = options.durable
    this.path = options.jsonlPath
      ? isAbsolute(options.jsonlPath) ? options.jsonlPath : resolve(this.workspaceRoot, options.jsonlPath)
      : resolve(this.workspaceRoot, '.pandoshare/loop-engineering/events.jsonl')
  }

  recordSpec(spec: LoopSpecV3): Promise<LoopEngineeringJournalRecord> {
    return this.appendRecord(LOOP_ENGINEERING_EVENT_TYPES.specRecorded, spec.loopId, spec.goalId, { spec })
  }

  recordAutomationTick(result: AutomationTickResult): Promise<LoopEngineeringJournalRecord> {
    return this.appendRecord(LOOP_ENGINEERING_EVENT_TYPES.automationTick, result.loopId, result.goalId, result)
  }

  recordVerifierGraph(input: { loopId: string; goalId?: string; result: VerificationGraphResult }): Promise<LoopEngineeringJournalRecord> {
    return this.appendRecord(LOOP_ENGINEERING_EVENT_TYPES.verifierGraph, input.loopId, input.goalId, input.result)
  }

  recordSubAgentAssignment(input: { loopId: string; goalId?: string; result: SubAgentAssignmentResult }): Promise<LoopEngineeringJournalRecord> {
    return this.appendRecord(LOOP_ENGINEERING_EVENT_TYPES.subagentAssignment, input.loopId, input.goalId, input.result)
  }

  recordSkillCandidate(input: { loopId: string; goalId?: string; result: SkillCandidateWriteResult }): Promise<LoopEngineeringJournalRecord> {
    return this.appendRecord(LOOP_ENGINEERING_EVENT_TYPES.skillCandidate, input.loopId, input.goalId, input.result)
  }

  async readRecords(input: { loopId?: string } = {}): Promise<LoopEngineeringJournalRecord[]> {
    if (this.durable) {
      const events = await this.durable.readEvents(input.loopId ? { loopId: input.loopId } : {})
      return events
        .filter(event => isLoopEngineeringEventType(event.eventType))
        .map(event => ({
          eventType: event.eventType as LoopEngineeringEventType,
          workspaceId: event.workspaceId,
          loopId: event.loopId ?? '',
          goalId: event.goalId,
          createdAtMs: event.createdAtMs,
          payload: event.payload,
        }))
    }
    try {
      const text = await readFile(this.path, 'utf8')
      return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as LoopEngineeringJournalRecord)
        .filter(record => input.loopId === undefined || record.loopId === input.loopId)
    } catch {
      return []
    }
  }

  private async appendRecord(eventType: LoopEngineeringEventType, loopId: string, goalId: string | undefined, payload: unknown): Promise<LoopEngineeringJournalRecord> {
    const record: LoopEngineeringJournalRecord = {
      eventType,
      workspaceId: this.workspaceId,
      loopId,
      goalId,
      createdAtMs: Date.now(),
      payload,
    }
    JSON.stringify(record)
    if (this.durable) {
      await this.durable.appendEvent({
        eventType,
        workspaceId: this.workspaceId,
        loopId,
        goalId,
        createdAtMs: record.createdAtMs,
        payload,
      })
      return record
    }
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, JSON.stringify(record) + '\n', 'utf8')
    return record
  }
}

export function isLoopEngineeringEventType(value: string): value is LoopEngineeringEventType {
  return Object.values(LOOP_ENGINEERING_EVENT_TYPES).includes(value as LoopEngineeringEventType)
}