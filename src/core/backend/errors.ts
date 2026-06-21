import type { BackendErrorResponse } from './types.js'

export class BackendError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: unknown

  constructor(code: string, message: string, status = 500, detail?: unknown) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

export class BackendValidationError extends BackendError {
  constructor(message: string, detail?: unknown) {
    super('backend_validation_error', message, 400, detail)
    this.name = 'BackendValidationError'
  }
}

export class BackendUnsupportedActionError extends BackendError {
  constructor(action: string) {
    super('backend_unsupported_action', `Unsupported backend action: ${action}`, 404, { action })
    this.name = 'BackendUnsupportedActionError'
  }
}

export function toBackendErrorResponse(error: unknown): BackendErrorResponse {
  if (error instanceof BackendError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      detail: error.detail,
    }
  }
  if (error instanceof Error) {
    return {
      code: 'backend_internal_error',
      message: error.message,
      status: 500,
    }
  }
  return {
    code: 'backend_internal_error',
    message: String(error),
    status: 500,
  }
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BackendValidationError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackendValidationError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}
