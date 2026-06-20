#!/usr/bin/env node
const { formatApprovalPrompt } = await import('../dist/src/services/permissions/terminalApproval.js')

const prompt = formatApprovalPrompt({
  toolUse: {
    id: 'call_external',
    name: 'shell_command',
    input: {
      command: 'echo ok',
      apiKey: 'secret-value',
    },
  },
  toolName: 'shell_command',
  safety: 'external_write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
  reason: 'external command or external write is not allowed by workspace-write',
  risk: 'high',
})

assert(prompt.includes('Permission approval required'), 'prompt should include title')
assert(prompt.includes('Tool: shell_command'), 'prompt should include tool name')
assert(prompt.includes('Risk: high'), 'prompt should include risk')
assert(prompt.includes('<redacted>'), 'prompt should redact secret-looking input')
assert(!prompt.includes('secret-value'), 'prompt should not leak secret value')

console.log('terminal approval smoke passed')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
