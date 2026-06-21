import type { EventEnvelope } from '../protocol/index.js'
import type { GuiRuntimeActionRecord } from '../gui/index.js'
import type { GuiMockScenarioStats } from './GuiMockScenarioAdapter.js'
import type { GuiBenchmarkEvidence, GuiBenchmarkMetrics, GuiBenchmarkRecoveryDecision, GuiBenchmarkReplayRef, GuiBenchmarkScenario, GuiBenchmarkScenarioResult, GuiBenchmarkStatus, GuiDingxuProbeResult } from './GuiBenchmarkTypes.js'

export class GuiBenchmarkScorer {
  fromRuntime(input: {
    scenario: GuiBenchmarkScenario
    scenarioPath?: string
    durationMs: number
    record?: GuiRuntimeActionRecord
    events: EventEnvelope[]
    stats: GuiMockScenarioStats
    recoveryDecision?: GuiBenchmarkRecoveryDecision
  }): GuiBenchmarkScenarioResult {
    const eventIds = unique([
      ...(input.record?.eventIds ?? []),
      ...input.events.map(event => event.eventId),
    ])
    const screenshotRefs = unique([
      ...input.stats.screenshotRefs,
      input.record?.screenshotRef,
      input.record?.beforeObservation?.screenshotRef,
      input.record?.afterObservation?.screenshotRef,
      input.record?.result?.screenshotRef,
      input.record?.result?.screenshotPath,
      input.record?.verification?.screenshotRef,
    ])
    const stuckDetected = input.record?.state === 'stuck' || input.events.some(event => event.eventType === 'gui_action_stuck')
    const inputReleased = input.stats.releaseCount > 0 || input.events.some(event => event.eventType === 'gui_input_released')
    const approvalRequired = input.record?.approval?.required === true || input.events.some(event => event.eventType === 'gui_action_approval_required')
    const verificationStatus = input.record?.verification?.status ?? (approvalRequired ? 'skipped' : 'inconclusive')
    const baseMetrics: GuiBenchmarkMetrics = {
      success: false,
      durationMs: input.durationMs,
      observationLatencyMs: input.stats.observationLatencyMs,
      actionLatencyMs: input.stats.actionLatencyMs,
      verificationLatencyMs: input.stats.verificationLatencyMs,
      verificationStatus,
      stuckDetected,
      inputReleased,
      approvalRequired,
      recoveryDecision: input.recoveryDecision ?? (stuckDetected ? undefined : 'not_applicable'),
      screenshotRefs,
      eventIds,
      failureReason: failureReason(input.record),
    }
    const status = this.statusFor(input.scenario, baseMetrics, {
      actionExecuted: input.stats.actionCount > 0,
      eventCount: eventIds.length,
    })
    return {
      id: input.scenario.id,
      title: input.scenario.title,
      type: input.scenario.type,
      mode: input.scenario.mode,
      status,
      metrics: {
        ...baseMetrics,
        success: status === 'passed',
      },
      replayRefs: replayRefs(eventIds, input.record?.checkpointId, screenshotRefs),
      evidence: {
        actionExecuted: input.stats.actionCount > 0,
        adapterActionCount: input.stats.actionCount,
        adapterReleaseCount: input.stats.releaseCount,
        recordState: input.record?.state,
        guiActionId: input.record?.identity.guiActionId,
        checkpointId: input.record?.checkpointId,
      },
      scenarioPath: input.scenarioPath,
    }
  }

  fromProbe(input: { scenario: GuiBenchmarkScenario; scenarioPath?: string; probe: GuiDingxuProbeResult }): GuiBenchmarkScenarioResult {
    const metrics: GuiBenchmarkMetrics = {
      success: input.probe.status === 'passed',
      durationMs: input.probe.durationMs,
      observationLatencyMs: input.probe.durationMs,
      actionLatencyMs: 0,
      verificationLatencyMs: 0,
      verificationStatus: input.probe.status === 'passed' ? 'passed' : 'skipped',
      stuckDetected: false,
      inputReleased: false,
      approvalRequired: false,
      recoveryDecision: input.probe.code === 'ok' ? 'not_applicable' : input.probe.code,
      screenshotRefs: input.probe.screenshotRefs,
      eventIds: input.probe.eventIds,
      failureReason: input.probe.status === 'passed' ? undefined : input.probe.code,
    }
    const status: GuiBenchmarkStatus = input.probe.status === 'passed'
      ? 'passed'
      : input.probe.status === 'skipped'
        ? 'skipped'
        : input.probe.status === 'partial'
          ? 'partial'
          : 'failed'
    return {
      id: input.scenario.id,
      title: input.scenario.title,
      type: input.scenario.type,
      mode: input.scenario.mode,
      status,
      metrics,
      replayRefs: replayRefs(input.probe.eventIds, undefined, input.probe.screenshotRefs),
      evidence: {
        dingxuProbeCode: input.probe.code,
        dingxuDiagnostic: input.probe.diagnostic ?? input.probe.message,
      },
      scenarioPath: input.scenarioPath,
    }
  }

  private statusFor(
    scenario: GuiBenchmarkScenario,
    metrics: GuiBenchmarkMetrics,
    evidence: { actionExecuted: boolean; eventCount: number },
  ): GuiBenchmarkStatus {
    const expectations = scenario.expectations
    if (!expectations) return metrics.verificationStatus === 'passed' ? 'passed' : 'failed'
    const checks = [
      expectations.verificationStatus === undefined || metrics.verificationStatus === expectations.verificationStatus,
      expectations.stuckDetected === undefined || metrics.stuckDetected === expectations.stuckDetected,
      expectations.inputReleased === undefined || metrics.inputReleased === expectations.inputReleased,
      expectations.approvalRequired === undefined || metrics.approvalRequired === expectations.approvalRequired,
      expectations.recoveryDecision === undefined || metrics.recoveryDecision === expectations.recoveryDecision,
      expectations.minEventCount === undefined || evidence.eventCount >= expectations.minEventCount,
      expectations.actionExecuted === undefined || evidence.actionExecuted === expectations.actionExecuted,
      expectations.failureReason === undefined || metrics.failureReason === expectations.failureReason,
    ]
    if (!checks.every(Boolean)) return 'failed'
    return expectations.status ?? 'passed'
  }
}

function failureReason(record: GuiRuntimeActionRecord | undefined): string | undefined {
  if (!record) return undefined
  if (record.state === 'completed' || record.state === 'verified' || record.state === 'waiting_approval') return undefined
  return record.verification?.reasonCode ?? record.result?.failureClass ?? record.verification?.message ?? record.result?.message ?? record.state
}

function replayRefs(eventIds: string[], checkpointId: string | undefined, screenshotRefs: string[]): GuiBenchmarkReplayRef[] {
  return [
    ...eventIds.map(eventId => ({ kind: 'event' as const, label: eventId, ref: `event://${eventId}` })),
    ...(checkpointId ? [{ kind: 'checkpoint' as const, label: checkpointId, ref: `checkpoint://${checkpointId}` }] : []),
    ...screenshotRefs.map(ref => ({ kind: 'screenshot' as const, label: ref, ref })),
  ]
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

