import type { GatewayAdapterFailureClass } from './GatewayChannelAdapter.js'

export type ReconnectDecision = {
  attempt: number
  delayMs: number
  shouldRetry: boolean
  nextAttemptAtMs?: number
  status: 'retry_scheduled' | 'failed'
  reason: string
}

export type ReconnectPolicyInput = {
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  jitterRatio?: number
}

export class ReconnectPolicy {
  constructor(private readonly input: ReconnectPolicyInput = {}) {}

  next(attempt: number, input: { failureClass?: GatewayAdapterFailureClass; retryAfterMs?: number; nowMs?: number } = {}): ReconnectDecision {
    const maxAttempts = this.input.maxAttempts ?? 8
    const nowMs = input.nowMs ?? Date.now()
    if (input.failureClass === 'permanent' || input.failureClass === 'missing_config') {
      return { attempt, shouldRetry: false, delayMs: 0, status: 'failed', reason: input.failureClass }
    }
    if (attempt >= maxAttempts) {
      return { attempt, shouldRetry: false, delayMs: 0, status: 'failed', reason: 'max_attempts_exceeded' }
    }
    const delayMs = input.retryAfterMs ?? this.computeDelay(attempt)
    return {
      attempt,
      shouldRetry: true,
      delayMs,
      nextAttemptAtMs: nowMs + delayMs,
      status: 'retry_scheduled',
      reason: input.failureClass ?? 'retryable_failure',
    }
  }

  private computeDelay(attempt: number): number {
    const baseDelayMs = this.input.baseDelayMs ?? 500
    const maxDelayMs = this.input.maxDelayMs ?? 30_000
    const jitterRatio = this.input.jitterRatio ?? 0.2
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1))
    const jitter = Math.floor(exponential * jitterRatio * deterministicJitter(attempt))
    return Math.min(maxDelayMs, exponential + jitter)
  }
}

function deterministicJitter(attempt: number): number {
  const x = Math.sin(attempt * 9301 + 49297) * 233280
  return Math.abs(x - Math.floor(x))
}
