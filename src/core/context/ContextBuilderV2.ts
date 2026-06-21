import { fitFragmentsToBudget, withTokenEstimate } from './ContextBudget.js'
import { contextPolicyFor } from './ContextPolicy.js'
import { createContextProvenance } from './ContextProvenance.js'
import type { ContextFragment, ContextPack, ContextRuntimeInput } from './ContextTypes.js'

let contextCounter = 0

export class ContextBuilderV2 {
  build(input: ContextRuntimeInput): ContextPack {
    contextCounter += 1
    const policy = contextPolicyFor(input.profile, input.budgetTokens)
    const baseFragments = (input.fragments ?? []).map(withTokenEstimate)
    const identityFragments = identityFragmentsFor(input)
    const allFragments = [...identityFragments, ...baseFragments]
    const fitted = fitFragmentsToBudget(allFragments, policy.budgetTokens)
    const byKind = (kind: ContextFragment['kind']) => fitted.included.filter(fragment => fragment.kind === kind)
    return {
      contextId: 'context_' + Date.now().toString(36) + '_' + contextCounter,
      profile: policy.profile,
      messages: byKind('message'),
      systemInstructions: byKind('system'),
      evidencePacks: input.evidencePacks ?? [],
      toolResultRefs: byKind('tool_result'),
      memorySnippets: byKind('memory'),
      compactionSummaries: byKind('compaction'),
      estimatedTokens: fitted.usedTokens,
      budgetTokens: policy.budgetTokens,
      provenance: fitted.included.map(fragment => fragment.provenance),
      audit: [
        ...fitted.included.map(fragment => ({ fragmentId: fragment.fragmentId, decision: 'included' as const, reason: fragment.provenance.reason })),
        ...fitted.dropped.map(fragment => ({ fragmentId: fragment.fragmentId, decision: 'dropped' as const, reason: 'budget exceeded' })),
      ],
    }
  }
}

function identityFragmentsFor(input: ContextRuntimeInput): ContextFragment[] {
  const ids = [['thread', input.threadId], ['run', input.runId], ['goal', input.goalId], ['loop', input.loopId], ['task', input.taskId]]
    .filter((item): item is [string, string] => typeof item[1] === 'string' && item[1].length > 0)
  if (!ids.length) return []
  return [withTokenEstimate({
    fragmentId: 'identity',
    kind: 'system',
    content: ids.map(([key, value]) => key + '=' + value).join(' '),
    protected: true,
    provenance: createContextProvenance({ source: 'system', sourceId: 'identity', reason: 'runtime identity', priority: 100 }),
  })]
}
