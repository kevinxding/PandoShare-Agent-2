import type { ContextFragment } from './ContextTypes.js'

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function withTokenEstimate(fragment: Omit<ContextFragment, 'estimatedTokens'> & { estimatedTokens?: number }): ContextFragment {
  return { ...fragment, estimatedTokens: fragment.estimatedTokens ?? estimateTokens(fragment.content) }
}

export function fitFragmentsToBudget(fragments: ContextFragment[], budgetTokens: number) {
  const sorted = [...fragments].sort((left, right) => {
    if (left.protected !== right.protected) return left.protected ? -1 : 1
    return right.provenance.priority - left.provenance.priority
  })
  const included: ContextFragment[] = []
  const dropped: ContextFragment[] = []
  let used = 0
  for (const fragment of sorted) {
    if (fragment.protected || used + fragment.estimatedTokens <= budgetTokens) {
      included.push(fragment)
      used += fragment.estimatedTokens
    } else {
      dropped.push(fragment)
    }
  }
  return { included, dropped, usedTokens: used }
}
