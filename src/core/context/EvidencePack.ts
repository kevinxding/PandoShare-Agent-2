import type { EvidencePack as EvidencePackRecord } from './ContextTypes.js'
import { createContextProvenance } from './ContextProvenance.js'

let evidenceCounter = 0

export function createEvidencePack(input: Omit<EvidencePackRecord, 'evidenceId' | 'provenance'> & { evidenceId?: string; reason?: string }): EvidencePackRecord {
  evidenceCounter += 1
  return {
    evidenceId: input.evidenceId ?? 'evidence_' + Date.now().toString(36) + '_' + evidenceCounter,
    title: input.title,
    refs: input.refs,
    summary: redactEvidenceSecrets(input.summary),
    provenance: createContextProvenance({ source: 'evidence', sourceId: input.evidenceId, reason: input.reason ?? 'explicit evidence pack', priority: 80 }),
  }
}

export function redactEvidenceSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '<redacted>')
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
}

