import type { ContextProfile } from './ContextTypes.js'

export type ContextPolicy = {
  profile: ContextProfile
  budgetTokens: number
  includeGui: boolean
  includeVerifierDetails: boolean
  includeToolRefs: boolean
  strictBudget: boolean
}

export function contextPolicyFor(profile: ContextProfile = 'build', budgetTokens = 8000): ContextPolicy {
  switch (profile) {
    case 'plan': return { profile, budgetTokens, includeGui: false, includeVerifierDetails: false, includeToolRefs: true, strictBudget: true }
    case 'gui': return { profile, budgetTokens, includeGui: true, includeVerifierDetails: false, includeToolRefs: true, strictBudget: true }
    case 'verifier': return { profile, budgetTokens, includeGui: false, includeVerifierDetails: true, includeToolRefs: true, strictBudget: true }
    default: return { profile: 'build', budgetTokens, includeGui: true, includeVerifierDetails: true, includeToolRefs: true, strictBudget: true }
  }
}
