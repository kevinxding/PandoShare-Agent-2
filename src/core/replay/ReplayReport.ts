import type { ReplayTimelineItem } from './EventReplay.js'
import type { ConsistencyAuditResult, KernelCheckpoint, RecoveryDecision } from '../durable/index.js'
import type { LoopState } from '../loop/index.js'

export class ReplayReport {
  toMarkdown(input: {
    title?: string
    runId?: string
    status?: string
    timeline: readonly ReplayTimelineItem[]
    checkpoints?: readonly KernelCheckpoint[]
    recoveryDecision?: RecoveryDecision
    audit?: ConsistencyAuditResult
    loopState?: LoopState
  }): string {
    const inferredLoopState = input.loopState
    const lines = [
      `# ${input.title ?? 'Pando Run Replay'}`,
      '',
      ...(input.runId ? [`Run: ${input.runId}`, ''] : []),
      ...(input.status ? [`Status: ${input.status}`, ''] : []),
      `Total events: ${input.timeline.length}`,
      '',
      ...(inferredLoopState ? [
        '## Loop Projection',
        '',
        `Loop: ${inferredLoopState.loopId}`,
        `Goal: ${inferredLoopState.goalId}`,
        `Status: ${inferredLoopState.status}`,
        `Tasks: ${inferredLoopState.tasks.length}`,
        `Attempts: ${inferredLoopState.attempts.length}`,
        `Pending human gate: ${inferredLoopState.pendingHumanGateId ?? 'none'}`,
        `Verification: ${inferredLoopState.verificationSummary ?? 'none'}`,
        `Recovery decision: ${inferredLoopState.recoveryDecision ?? 'none'}`,
        ...(inferredLoopState.tasks.length ? ['', ...inferredLoopState.tasks.map(task => `- task ${task.taskId}: ${task.status} (${task.title})`)] : []),
        ...(inferredLoopState.attempts.length ? ['', ...inferredLoopState.attempts.map(attempt => `- attempt ${attempt.attemptId}: ${attempt.status}${attempt.runId ? ` run=${attempt.runId}` : ''}`)] : []),
        ...(inferredLoopState.warnings.length ? ['', ...inferredLoopState.warnings.map(warning => `- warning: ${warning}`)] : []),
        '',
      ] : []),
      ...guiTimelineSection(input.timeline),
      ...gatewayTimelineSection(input.timeline),
      ...modelTimelineSection(input.timeline),
      ...(input.recoveryDecision ? [
        '## Recovery',
        '',
        `Decision: ${input.recoveryDecision.decision}`,
        `Reason: ${input.recoveryDecision.reason}`,
        '',
      ] : []),
      ...(input.audit ? [
        '## Audit',
        '',
        `OK: ${input.audit.ok ? 'true' : 'false'}`,
        `Warnings: ${input.audit.warnings.length}`,
        `Errors: ${input.audit.errors.length}`,
        ...input.audit.warnings.map(warning => `- warning: ${warning}`),
        ...input.audit.errors.map(error => `- error: ${error}`),
        '',
      ] : []),
      ...(input.checkpoints?.length ? [
        '## Checkpoints',
        '',
        ...input.checkpoints.map(checkpoint => `- ${checkpoint.checkpointId}: ${checkpoint.status}, lastSeq=${checkpoint.lastEventSeq}`),
        '',
      ] : []),
      '## Timeline',
      '',
    ]
    for (const item of input.timeline) {
      lines.push(`- ${item.seq}. ${item.category}/${item.eventType} (${new Date(item.createdAtMs).toISOString()})`)
      if (item.warning) lines.push(`  warning: ${item.warning}`)
    }
    return `${lines.join('\n')}\n`
  }
}

function modelTimelineSection(timeline: readonly ReplayTimelineItem[]): string[] {
  const modelItems = timeline.filter(item => item.category === 'model' || item.eventType.startsWith('model_'))
  if (!modelItems.length) return []
  const lines = ['## Model Timeline', '']
  for (const item of modelItems) {
    const payload = recordPayload(item.payload)
    lines.push(`- ${item.seq}. ${item.eventType}: ${modelSummary(payload)}`)
    for (const key of ['routeId', 'profileId', 'taskType', 'selectedProviderId', 'selectedModelId', 'providerId', 'modelId', 'status', 'reason']) {
      const value = stringValue(payload, key)
      if (value) lines.push(`  ${key}: ${value}`)
    }
  }
  lines.push('')
  return lines
}

function modelSummary(payload: Record<string, unknown>): string {
  return stringValue(payload, 'message')
    ?? stringValue(payload, 'reason')
    ?? stringValue(payload, 'selectedProviderId')
    ?? stringValue(payload, 'providerId')
    ?? 'model event'
}
function gatewayTimelineSection(timeline: readonly ReplayTimelineItem[]): string[] {
  const gatewayItems = timeline.filter(item => item.category === 'gateway')
  if (!gatewayItems.length) return []
  const lines = ['## Gateway Timeline', '']
  for (const item of gatewayItems) {
    const payload = recordPayload(item.payload)
    lines.push(`- ${item.seq}. ${item.eventType}: ${gatewaySummary(payload)}`)
    for (const key of ['gatewayId', 'sessionId', 'channelId', 'channelKind', 'inboundId', 'deliveryId', 'commandId', 'commandType', 'approvalId', 'loopId', 'runId', 'status']) {
      const value = stringValue(payload, key)
      if (value) lines.push(`  ${key}: ${value}`)
    }
  }
  lines.push('')
  return lines
}

function gatewaySummary(payload: Record<string, unknown>): string {
  return stringValue(payload, 'message')
    ?? stringValue(payload, 'reason')
    ?? stringValue(payload, 'textPreview')
    ?? stringValue(payload, 'replyPreview')
    ?? stringValue(payload, 'lastError')
    ?? 'gateway event'
}
function guiTimelineSection(timeline: readonly ReplayTimelineItem[]): string[] {
  const guiItems = timeline.filter(item => item.category === 'gui')
  if (!guiItems.length) return []
  const lines = ['## GUI Timeline', '']
  for (const item of guiItems) {
    const payload = recordPayload(item.payload)
    const action = recordPayload(payload.action)
    const risk = recordPayload(payload.risk)
    const approval = recordPayload(payload.approval)
    const verification = recordPayload(payload.verification)
    lines.push(`- ${item.seq}. ${item.eventType}: ${stringValue(payload, 'guiActionId') ?? 'unknown_gui_action'}`)
    if (stringValue(action, 'action') || stringValue(payload, 'action')) lines.push(`  action: ${stringValue(action, 'action') ?? stringValue(payload, 'action')}`)
    if (stringValue(payload, 'state')) lines.push(`  state: ${stringValue(payload, 'state')}`)
    if (stringValue(risk, 'level')) lines.push(`  risk: ${stringValue(risk, 'level')}`)
    if (stringValue(approval, 'status')) lines.push(`  approval: ${stringValue(approval, 'status')}`)
    if (stringValue(payload, 'observationId')) lines.push(`  observation: ${stringValue(payload, 'observationId')}`)
    if (stringValue(payload, 'beforeObservationId') || stringValue(verification, 'beforeObservationId')) lines.push(`  before: ${stringValue(payload, 'beforeObservationId') ?? stringValue(verification, 'beforeObservationId')}`)
    if (stringValue(payload, 'afterObservationId') || stringValue(verification, 'afterObservationId')) lines.push(`  after: ${stringValue(payload, 'afterObservationId') ?? stringValue(verification, 'afterObservationId')}`)
    if (stringValue(payload, 'screenshotRef') || stringValue(verification, 'screenshotRef')) lines.push(`  screenshotRef: ${stringValue(payload, 'screenshotRef') ?? stringValue(verification, 'screenshotRef')}`)
    if (stringValue(verification, 'status')) lines.push(`  verification: ${stringValue(verification, 'status')}`)
    if (stringValue(payload, 'checkpointId')) lines.push(`  checkpoint: ${stringValue(payload, 'checkpointId')}`)
  }
  lines.push('')
  return lines
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}
