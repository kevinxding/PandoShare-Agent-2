import type { DurableRuntime } from '../durable/index.js'
import { defaultCompactionPolicy, type CompactionPolicy } from './CompactionPolicy.js'
import { CompactionVerifier, type ToolTranscriptMessage } from './CompactionVerifier.js'

export type CompactionRuntimeInput = {
  workspaceId?: string
  threadId?: string
  runId?: string
  messages: ToolTranscriptMessage[]
  summaryParts?: string[]
}

export type CompactionRuntimeResult = {
  ok: boolean
  summary: string
  eventIds: string[]
  verification: { ok: boolean; errors: string[] }
}

export class CompactionRuntime {
  constructor(
    private readonly durable?: DurableRuntime,
    private readonly policy: CompactionPolicy = defaultCompactionPolicy(),
    private readonly verifier = new CompactionVerifier(),
  ) {}

  async compact(input: CompactionRuntimeInput): Promise<CompactionRuntimeResult> {
    const eventIds: string[] = []
    eventIds.push(...await this.emit('compaction_requested', input))
    eventIds.push(...await this.emit('compaction_started', input))
    const verification = this.policy.requireToolPairing ? this.verifier.verifyToolPairing(input.messages) : { ok: true, errors: [] }
    const summary = (input.summaryParts?.join('\n') || summarize(input.messages)).slice(0, this.policy.maxSummaryChars)
    eventIds.push(...await this.emit(verification.ok ? 'compaction_completed' : 'compaction_failed', input, { summaryChars: summary.length, errors: verification.errors }))
    return { ok: verification.ok, summary, eventIds, verification }
  }

  private async emit(eventType: string, input: CompactionRuntimeInput, payload: Record<string, unknown> = {}): Promise<string[]> {
    if (!this.durable) return []
    const event = await this.durable.appendEvent({ eventType, workspaceId: input.workspaceId ?? 'default', threadId: input.threadId, runId: input.runId, payload })
    return [event.eventId]
  }
}

function summarize(messages: readonly ToolTranscriptMessage[]): string {
  return 'Compacted ' + messages.length + ' message(s). Decisions, unresolved questions, tool refs, files touched, tests, and approvals should be preserved by callers when available.'
}
