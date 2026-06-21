import { createGuiObservationId } from '../gui/GuiIdentity.js'
import type { GuiAdapter, GuiAdapterResult, GuiObservation, GuiRuntimeAction, GuiRuntimeContext, GuiVerification } from '../gui/index.js'
import type { GuiBenchmarkScenario } from './GuiBenchmarkTypes.js'

export type GuiMockScenarioStats = {
  observationLatencyMs: number
  actionLatencyMs: number
  verificationLatencyMs: number
  observeCount: number
  actionCount: number
  releaseCount: number
  screenshotRefs: string[]
}

export class GuiMockScenarioAdapter implements GuiAdapter {
  readonly stats: GuiMockScenarioStats = {
    observationLatencyMs: 0,
    actionLatencyMs: 0,
    verificationLatencyMs: 0,
    observeCount: 0,
    actionCount: 0,
    releaseCount: 0,
    screenshotRefs: [],
  }

  constructor(private readonly scenario: GuiBenchmarkScenario) {}

  async observe(context?: GuiRuntimeContext): Promise<GuiObservation> {
    const latencyMs = nonNegative(this.scenario.mock?.observationLatencyMs ?? 1)
    this.stats.observationLatencyMs += latencyMs
    this.stats.observeCount += 1
    await sleep(latencyMs)
    const now = Date.now()
    const screenshotRef = this.nextScreenshotRef('observe')
    return {
      observationId: createGuiObservationId(now),
      createdAtMs: now,
      screenshotRef,
      focusedApp: 'mock-gui-benchmark',
      focusedElement: context?.guiActionId,
      summary: `Mock GUI benchmark observation for ${this.scenario.id}.`,
      source: 'mock',
      confidence: 1,
    }
  }

  async act(action: GuiRuntimeAction): Promise<GuiAdapterResult> {
    if (normalizeAction(action.action) === 'release_all') {
      this.stats.releaseCount += 1
      return {
        ok: true,
        method: 'mock',
        message: `Mock release_all completed for ${this.scenario.id}.`,
        screenshotRef: this.nextScreenshotRef('release'),
      }
    }
    this.stats.actionCount += 1
    const latencyMs = nonNegative(this.scenario.mock?.actionLatencyMs ?? 1)
    this.stats.actionLatencyMs += latencyMs
    await sleep(latencyMs)
    const ok = this.scenario.mock?.actionOk ?? true
    return {
      ok,
      method: 'mock',
      message: this.scenario.mock?.actionMessage ?? `Mock GUI action completed: ${action.action}`,
      screenshotRef: this.nextScreenshotRef('action'),
      failureClass: ok ? undefined : 'mock_action_failed',
      audit: {
        tool: 'gui_mock_scenario_adapter',
        scenarioId: this.scenario.id,
      },
    }
  }

  async verify(action: GuiRuntimeAction): Promise<GuiVerification> {
    const latencyMs = nonNegative(this.scenario.mock?.verificationLatencyMs ?? 1)
    this.stats.verificationLatencyMs += latencyMs
    await sleep(latencyMs)
    const status = this.scenario.mock?.verificationStatus ?? 'passed'
    const ok = status === 'passed'
    return {
      ok,
      status,
      message: this.scenario.mock?.verificationMessage ?? `Mock GUI verification ${status}: ${action.action}`,
      screenshotRef: this.nextScreenshotRef('verify'),
      visualChange: status === 'passed' ? 'changed' : 'unknown',
      confidence: ok ? 1 : 0.2,
      reasonCode: ok ? undefined : 'mock_verification_failed',
    }
  }

  private nextScreenshotRef(kind: string): string {
    const configured = this.scenario.mock?.screenshotRefs ?? []
    const ref = configured[this.stats.screenshotRefs.length] ?? `mock://gui-benchmark/${this.scenario.id}/${kind}-${this.stats.screenshotRefs.length + 1}.png`
    this.stats.screenshotRefs.push(ref)
    return ref
  }
}

function normalizeAction(action: string): string {
  return action.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function nonNegative(value: number): number {
  return Math.max(0, Math.trunc(value))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => { globalThis.setTimeout(resolveSleep, ms) })
}

