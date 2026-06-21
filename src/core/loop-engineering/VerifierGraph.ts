import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { VerificationPlanV3, VerifierNodeSpec } from './LoopSpecV3.js'
import { validateLoopSpecV3, type LoopSpecV3 } from './LoopSpecV3.js'

export type VerifierCommandResult = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export type VerifierGraphContext = {
  workspaceRoot?: string
  builderFamilies?: readonly string[]
  allowSameFamilyVerifier?: boolean
  commandRunner?: (node: Extract<VerifierNodeSpec, { type: 'command' }>) => Promise<VerifierCommandResult>
  replayResults?: Record<string, { status: 'passed' | 'failed'; summary?: string }>
  customHandlers?: Record<string, (node: Extract<VerifierNodeSpec, { type: 'custom' }>) => Promise<VerifierNodeExecutionResult> | VerifierNodeExecutionResult>
}

export type VerifierNodeStatus = 'passed' | 'failed' | 'skipped'

export type VerifierNodeExecutionResult = {
  ok: boolean
  message: string
  reason?: string
  metadata?: Record<string, unknown>
}

export type VerificationNodeResult = VerifierNodeExecutionResult & {
  nodeId: string
  type: VerifierNodeSpec['type']
  status: VerifierNodeStatus
  dependsOn: readonly string[]
  verifierId?: string
  verifierFamily?: string
}

export type VerificationGraphResult = {
  graphId: string
  ok: boolean
  startedAtMs: number
  completedAtMs: number
  nodeResults: VerificationNodeResult[]
  failureReasons: string[]
}

export class VerifierGraph {
  async run(plan: VerificationPlanV3, context: VerifierGraphContext = {}): Promise<VerificationGraphResult> {
    const startedAtMs = Date.now()
    const validationErrors = validatePlanOnly(plan)
    if (validationErrors.length > 0) {
      return {
        graphId: plan.graphId ?? 'verification_graph',
        ok: false,
        startedAtMs,
        completedAtMs: Date.now(),
        nodeResults: [],
        failureReasons: validationErrors,
      }
    }

    const nodeResults: VerificationNodeResult[] = []
    const completed = new Map<string, VerificationNodeResult>()
    const pending = new Map(plan.nodes.map(node => [node.nodeId, node] as const))

    while (pending.size > 0) {
      let progressed = false
      for (const node of [...pending.values()]) {
        const dependencies = node.dependsOn ?? []
        if (!dependencies.every(dependency => completed.has(dependency))) continue
        const result = await this.runReadyNode(node, context, completed)
        completed.set(node.nodeId, result)
        nodeResults.push(result)
        pending.delete(node.nodeId)
        progressed = true
      }
      if (!progressed) {
        const blocked = [...pending.keys()].join(', ')
        return {
          graphId: plan.graphId ?? 'verification_graph',
          ok: false,
          startedAtMs,
          completedAtMs: Date.now(),
          nodeResults,
          failureReasons: [`verification graph has unresolved dependency cycle or missing dependency among: ${blocked}`],
        }
      }
    }

    const requiredNodeIds = plan.requiredNodeIds ?? plan.nodes.map(node => node.nodeId)
    const failureReasons = nodeResults
      .filter(result => requiredNodeIds.includes(result.nodeId) && result.status !== 'passed')
      .map(result => `${result.nodeId}: ${result.reason ?? result.message}`)
    return {
      graphId: plan.graphId ?? 'verification_graph',
      ok: failureReasons.length === 0,
      startedAtMs,
      completedAtMs: Date.now(),
      nodeResults,
      failureReasons,
    }
  }

  private async runReadyNode(node: VerifierNodeSpec, context: VerifierGraphContext, completed: Map<string, VerificationNodeResult>): Promise<VerificationNodeResult> {
    const dependencies = node.dependsOn ?? []
    const failedDependency = dependencies.find(dependency => completed.get(dependency)?.status !== 'passed')
    if (failedDependency) {
      return toNodeResult(node, {
        ok: false,
        message: `Skipped because dependency failed: ${failedDependency}`,
        reason: 'dependency_failed',
      }, 'skipped')
    }

    const identityFailure = validateVerifierIdentity(node, context)
    if (identityFailure) return toNodeResult(node, identityFailure, 'failed')

    const result = await this.executeNode(node, context)
    return toNodeResult(node, result, result.ok ? 'passed' : 'failed')
  }

  private async executeNode(node: VerifierNodeSpec, context: VerifierGraphContext): Promise<VerifierNodeExecutionResult> {
    switch (node.type) {
      case 'command':
        return this.executeCommand(node, context)
      case 'file':
        return this.executeFile(node, context)
      case 'replay':
        return this.executeReplay(node, context)
      case 'model_mock':
        return this.executeModelMock(node)
      case 'custom':
        return this.executeCustom(node, context)
    }
  }

  private async executeCommand(node: Extract<VerifierNodeSpec, { type: 'command' }>, context: VerifierGraphContext): Promise<VerifierNodeExecutionResult> {
    if (!context.commandRunner) {
      return {
        ok: false,
        message: 'Command verifier requires an injected commandRunner.',
        reason: 'command_runner_missing',
        metadata: { command: node.command, cwd: node.cwd, timeoutMs: node.timeoutMs },
      }
    }
    const result = await context.commandRunner(node)
    const ok = result.exitCode === 0
    return {
      ok,
      message: ok ? `Command verifier passed: ${node.command}` : `Command verifier failed with exitCode=${result.exitCode}: ${node.command}`,
      reason: ok ? undefined : 'command_exit_nonzero',
      metadata: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    }
  }

  private async executeFile(node: Extract<VerifierNodeSpec, { type: 'file' }>, context: VerifierGraphContext): Promise<VerifierNodeExecutionResult> {
    const target = resolveVerifierPath(context.workspaceRoot, node.path)
    const exists = await pathExists(target)
    const shouldExist = node.exists ?? true
    if (exists !== shouldExist) {
      return {
        ok: false,
        message: shouldExist ? `Expected file to exist: ${node.path}` : `Expected file to be absent: ${node.path}`,
        reason: 'file_existence_mismatch',
      }
    }
    if (!exists || node.contains === undefined) return { ok: true, message: `File verifier passed: ${node.path}` }
    const content = await readFile(target, 'utf8')
    const ok = content.includes(node.contains)
    return {
      ok,
      message: ok ? `File contains expected text: ${node.path}` : `File missing expected text: ${node.path}`,
      reason: ok ? undefined : 'file_content_mismatch',
    }
  }

  private executeReplay(node: Extract<VerifierNodeSpec, { type: 'replay' }>, context: VerifierGraphContext): VerifierNodeExecutionResult {
    const replay = context.replayResults?.[node.replayId]
    if (!replay) return { ok: false, message: `Replay result not found: ${node.replayId}`, reason: 'replay_result_missing' }
    const expectedStatus = node.expectedStatus ?? 'passed'
    const ok = replay.status === expectedStatus
    return {
      ok,
      message: ok ? `Replay matched expected status: ${node.replayId}` : `Replay status mismatch: ${node.replayId}`,
      reason: ok ? undefined : 'replay_status_mismatch',
      metadata: { expectedStatus, actualStatus: replay.status, summary: replay.summary },
    }
  }

  private executeModelMock(node: Extract<VerifierNodeSpec, { type: 'model_mock' }>): VerifierNodeExecutionResult {
    const ok = node.expectedContains === undefined || node.mockOutput.includes(node.expectedContains)
    return {
      ok,
      message: ok ? 'Model mock verifier passed.' : 'Model mock output did not contain expected text.',
      reason: ok ? undefined : 'model_mock_mismatch',
      metadata: { expectedContains: node.expectedContains },
    }
  }

  private async executeCustom(node: Extract<VerifierNodeSpec, { type: 'custom' }>, context: VerifierGraphContext): Promise<VerifierNodeExecutionResult> {
    const handler = context.customHandlers?.[node.name]
    if (handler) return handler(node)
    if (node.expectedOk !== undefined) return { ok: node.expectedOk, message: `Custom verifier expectedOk=${node.expectedOk}`, reason: node.expectedOk ? undefined : 'custom_expected_failure' }
    return { ok: false, message: `Custom verifier handler not found: ${node.name}`, reason: 'custom_handler_missing' }
  }
}

function validateVerifierIdentity(node: VerifierNodeSpec, context: VerifierGraphContext): VerifierNodeExecutionResult | undefined {
  if (!node.verifierIdentity) return undefined
  const builderFamilies = new Set(context.builderFamilies ?? [])
  const allowSameFamily = context.allowSameFamilyVerifier === true
  if (!allowSameFamily && builderFamilies.has(node.verifierIdentity.family)) {
    return {
      ok: false,
      message: `Verifier ${node.verifierIdentity.verifierId} is not independent from builder family ${node.verifierIdentity.family}.`,
      reason: 'verifier_identity_not_independent',
      metadata: { verifierId: node.verifierIdentity.verifierId, family: node.verifierIdentity.family },
    }
  }
  return undefined
}

function toNodeResult(node: VerifierNodeSpec, result: VerifierNodeExecutionResult, status: VerifierNodeStatus): VerificationNodeResult {
  return {
    ...result,
    nodeId: node.nodeId,
    type: node.type,
    status,
    dependsOn: node.dependsOn ?? [],
    verifierId: node.verifierIdentity?.verifierId,
    verifierFamily: node.verifierIdentity?.family,
  }
}

function validatePlanOnly(plan: VerificationPlanV3): string[] {
  const specLike: LoopSpecV3 = {
    loopId: 'validation_loop',
    goalId: 'validation_goal',
    objective: 'Validate verifier plan.',
    successCriteria: ['verification plan validates'],
    verificationPlan: plan,
    automationTrigger: 'manual',
    workspaceIsolation: 'none',
    subagents: [],
    skillPolicy: { enabled: false, writeCandidates: false },
    connectorPolicy: { requirePlan: true, allowMcp: false, allowGateway: false, allowFile: false, allowGui: false },
    statePolicy: { journal: 'jsonl', replayReadable: true },
    budgetPolicy: {},
    humanGatePolicy: { approvalMode: 'manual', requireBeforeUnsafeConnector: true, requireOnVerifierFailure: true },
  }
  const validation = validateLoopSpecV3(specLike)
  return validation.ok ? [] : validation.errors.filter(error => error.startsWith('verificationPlan') || error.startsWith('duplicate verifier') || error.startsWith('requiredNodeIds'))
}

function resolveVerifierPath(workspaceRoot: string | undefined, path: string): string {
  if (isAbsolute(path)) return path
  return resolve(workspaceRoot ?? '.', path)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
