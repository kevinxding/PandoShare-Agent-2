import type { PolicyResult, PolicySubject } from './SandboxTypes.js'

export class SandboxViolation extends Error {
  readonly subject: PolicySubject
  readonly result: PolicyResult

  constructor(subject: PolicySubject, result: PolicyResult) {
    super(result.reason)
    this.name = 'SandboxViolation'
    this.subject = subject
    this.result = result
  }
}
