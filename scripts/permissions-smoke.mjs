#!/usr/bin/env node
const { createTextResult } = await import('../dist/src/Tool.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')

const registry = createToolRegistry([
  {
    name: 'read_probe',
    description: 'Read probe.',
    safety: 'read_only',
    execute(toolUse) {
      return createTextResult(toolUse.id, 'read-ok')
    },
  },
  {
    name: 'write_probe',
    description: 'Write probe.',
    safety: 'workspace_write',
    execute(toolUse) {
      return createTextResult(toolUse.id, 'write-ok')
    },
  },
  {
    name: 'external_probe',
    description: 'External probe.',
    safety: 'external_write',
    execute(toolUse) {
      return createTextResult(toolUse.id, 'external-ok')
    },
  },
])

const rootContext = {
  cwd: process.cwd(),
  sessionId: 'permissions-smoke',
  permissionMode: 'default',
}

assert((await runOne('read_probe', {}, rootContext)).ok, 'read-only tool should run in default permissions')

const blockedWrite = await runOne('write_probe', {}, {
  ...rootContext,
  permissions: {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'read-only',
  },
})
assert(!blockedWrite.ok, 'workspace write should be blocked by read-only + never')
assert(blockedWrite.metadata?.code === 'sandbox_denied', 'blocked write should report sandbox_denied')

const approvedWrite = await runOne('write_probe', {}, {
  ...rootContext,
  permissions: {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'read-only',
  },
  requestToolApproval() {
    return { approved: true, reason: 'smoke approval' }
  },
})
assert(approvedWrite.ok, 'approval handler should allow workspace write')

const externalNeedsApproval = await runOne('external_probe', {}, rootContext)
assert(!externalNeedsApproval.ok, 'external tool should require approval in default permissions')
assert(externalNeedsApproval.metadata?.code === 'approval_required', 'external tool should report approval_required')

const fullAccessExternal = await runOne('external_probe', {}, {
  ...rootContext,
  permissions: {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
  },
})
assert(fullAccessExternal.ok, 'danger-full-access + never should allow external tool')

console.log('permissions smoke passed')

async function runOne(name, input, context) {
  const results = []
  for await (const update of runTools([{ id: `call_${name}`, name, input }], registry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `${name} should return one result`)
  return results[0]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
