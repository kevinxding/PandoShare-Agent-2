import { createInterface } from 'node:readline/promises'

import type { ToolApprovalHandler, ToolApprovalRequest } from '../../Tool.js'

type ApprovalOutput = {
  write(text: string): void
}

type RuntimeProcess = {
  stdin: unknown
  stdout: ApprovalOutput
}

export type TerminalApprovalOptions = {
  input?: unknown
  output?: ApprovalOutput
}

export function createTerminalApprovalHandler(options: TerminalApprovalOptions = {}): ToolApprovalHandler {
  return async request => {
    const runtimeProcess = getRuntimeProcess()
    const input = options.input ?? runtimeProcess.stdin
    const output = options.output ?? runtimeProcess.stdout
    output.write(formatApprovalPrompt(request))

    const readline = createInterface({ input, output })
    try {
      const answer = (await readline.question('Approve this action? [y/N] ')).trim().toLowerCase()
      const approved = answer === 'y' || answer === 'yes'
      return {
        approved,
        reason: approved ? 'Approved by user.' : 'Denied by user.',
      }
    } finally {
      readline.close()
    }
  }
}

export function formatApprovalPrompt(request: ToolApprovalRequest): string {
  return [
    '',
    'Permission approval required',
    '----------------------------',
    `Tool: ${request.toolName}`,
    `Safety: ${request.safety}`,
    `Risk: ${request.risk}`,
    `Policy: ${request.approvalPolicy}`,
    `Reviewer: ${request.approvalsReviewer}`,
    `Sandbox: ${request.sandboxMode}`,
    `Reason: ${request.reason}`,
    'Input:',
    formatToolInput(request.toolUse.input),
    '',
  ].join('\n')
}

function formatToolInput(input: Record<string, unknown>): string {
  const text = JSON.stringify(input, redactSecrets, 2) ?? '{}'
  if (text.length <= 2000) return text
  return `${text.slice(0, 2000)}\n[truncated ${text.length - 2000} chars]`
}

function redactSecrets(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase()
  if (
    normalized.includes('apikey') ||
    normalized.includes('api_key') ||
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('secret')
  ) {
    return '<redacted>'
  }
  return value
}

function getRuntimeProcess(): RuntimeProcess {
  const runtime = globalThis as unknown as { process?: RuntimeProcess }
  if (!runtime.process) {
    throw new Error('process runtime is unavailable')
  }
  return runtime.process
}
