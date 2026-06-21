import { MemoryStore } from '../memory/index.js'

export type SkillCandidateInput = {
  skillId: string
  trigger: string
  procedure: readonly string[]
  verification: readonly string[]
  pitfalls: readonly string[]
  refs: readonly string[]
  source?: string
  goalId?: string
  loopId?: string
  tags?: readonly string[]
}

export type SkillCandidateWriteResult = {
  written: boolean
  skillId: string
  memoryId?: string
  redacted?: boolean
  reason?: string
  contentPreview?: string
}

export class SkillCandidateWriter {
  constructor(private readonly memoryStore = new MemoryStore()) {}

  async writeCandidate(input: SkillCandidateInput): Promise<SkillCandidateWriteResult> {
    validateCandidate(input)
    const existing = await this.memoryStore.read({ scope: 'skill', tags: [skillTag(input.skillId)], limit: 1 })
    if (existing.length > 0) return { written: false, skillId: input.skillId, reason: 'skill_candidate_exists' }

    const content = renderSkillCandidate(input)
    const record = await this.memoryStore.append({
      scope: 'skill',
      source: input.source ?? 'loop-engineering-v3',
      goalId: input.goalId,
      loopId: input.loopId,
      tags: ['loop-engineering-v3', skillTag(input.skillId), ...(input.tags ?? [])],
      content,
    })
    return {
      written: true,
      skillId: input.skillId,
      memoryId: record.memoryId,
      redacted: record.redacted,
      contentPreview: record.content.slice(0, 240),
    }
  }
}

export function renderSkillCandidate(input: SkillCandidateInput): string {
  return [
    `# ${input.skillId}`,
    '',
    '## Trigger',
    input.trigger,
    '',
    '## Procedure',
    ...input.procedure.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Verification',
    ...input.verification.map(item => `- ${item}`),
    '',
    '## Pitfalls',
    ...input.pitfalls.map(item => `- ${item}`),
    '',
    '## Refs',
    ...input.refs.map(item => `- ${item}`),
  ].join('\n')
}

function validateCandidate(input: SkillCandidateInput): void {
  if (!/^[A-Za-z0-9._-]+$/.test(input.skillId)) throw new Error('skillId must use ASCII letters, numbers, dot, underscore, or hyphen')
  if (!input.trigger.trim()) throw new Error('skill candidate trigger is required')
  for (const field of ['procedure', 'verification', 'pitfalls', 'refs'] as const) {
    if (!Array.isArray(input[field]) || input[field].length === 0 || !input[field].every(item => item.trim().length > 0)) {
      throw new Error(`skill candidate ${field} must contain non-empty strings`)
    }
  }
}

function skillTag(skillId: string): string {
  return `skill:${skillId}`
}