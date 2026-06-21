import type { EventEnvelope } from '../protocol/index.js'
import type {
  ReplayArtifactManifest,
  ReplayIncidentKind,
  ReplayIncidentSeverity,
  ReplayProjectionStatus,
  ReplayProjections,
  ReplayQuery,
  ReplayReportV2,
} from '../replay/index.js'

export type GoldenTraceProjectionKey = keyof ReplayProjections

export type GoldenTraceProjectionExpectation = {
  status?: ReplayProjectionStatus
  metrics?: Record<string, number>
}

export type GoldenTraceExpectedReportShape = {
  query?: Partial<ReplayQuery> & Pick<ReplayQuery, 'workspaceId' | 'scope'>
  status?: ReplayReportV2['status']
  eventCount?: number
  timelineLength?: number
  metrics?: Record<string, number>
  markdownSections?: string[]
  projections?: Partial<Record<GoldenTraceProjectionKey, GoldenTraceProjectionExpectation>>
  artifactKinds?: string[]
  redaction?: {
    redactedFieldCount?: number
    suspectedSecretPathCount?: number
  }
}

export type GoldenTraceExpectedIncident = {
  kind: ReplayIncidentKind
  severity?: ReplayIncidentSeverity
  eventIds?: string[]
  importantIds?: Record<string, string[]>
}

export type GoldenTraceExpectedGraphSummary = Partial<ReplayReportV2['causalGraphSummary']> & {
  edgeTypes?: Record<string, number>
  warnings?: string[]
}

export type GoldenTrace = {
  name: string
  traceDir: string
  events: EventEnvelope[]
  expectedReportShape: GoldenTraceExpectedReportShape
  expectedIncidents: GoldenTraceExpectedIncident[]
  expectedGraphSummary: GoldenTraceExpectedGraphSummary
  artifactsManifest: ReplayArtifactManifest
  readme: string
}

export type GoldenTraceUpdateFile = {
  fileName: string
  content: string
}

export type GoldenTraceUpdateResult = {
  traceName: string
  traceDir: string
  wrote: boolean
  files: GoldenTraceUpdateFile[]
}

export type GoldenTraceValidationResult = {
  traceName: string
  ok: boolean
  errors: string[]
  warnings: string[]
  report: ReplayReportV2
  diffMarkdown: string
}
