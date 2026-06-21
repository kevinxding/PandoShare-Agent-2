import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { ToolRuntime, type ToolRuntimeRequest } from '../tool/index.js'
import { PatchVerifier } from './PatchVerifier.js'
import { TestCommandRunner } from './TestCommandRunner.js'
import { parseCodeTaskFixture, type CodeTaskFixture, type CodeTaskOperation } from './CodeTaskFixture.js'
import type { CodeAgentHarnessResult } from './CodeAgentReport.js'

export type CodeAgentHarnessOptions = {
  tempRoot?: string
  workspaceId?: string
}

let runCounter = 0

export class CodeAgentHarness {
  constructor(
    private readonly options: CodeAgentHarnessOptions = {},
    private readonly testRunner = new TestCommandRunner(),
    private readonly patchVerifier = new PatchVerifier(),
  ) {}

  async loadFixture(path: string): Promise<CodeTaskFixture> {
    return parseCodeTaskFixture(JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')))
  }

  async runFixture(fixture: CodeTaskFixture): Promise<CodeAgentHarnessResult> {
    const startedAtMs = Date.now()
    runCounter += 1
    const root = resolve(this.options.tempRoot ?? '.tmp-code-agent', safeName(fixture.id) + '_' + runCounter)
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
    for (const file of fixture.files) await writeSeedFile(root, file.path, file.content)

    const runtime = new ToolRuntime({ workspaceRoot: root, workspaceId: this.options.workspaceId ?? 'default', resultRoot: resolve(root, '.tool-results') })
    const operationResults = []
    for (const operation of fixture.operations) operationResults.push(await runtime.execute(toToolRequest(operation)))

    const testResults = await this.testRunner.runAll(fixture.verifier.commands ?? [], root)
    const patchVerification = await this.patchVerifier.verify(root, fixture.verifier)
    const operationsOk = operationResults.every(result => result.state === 'completed')
    const testsOk = testResults.every(result => result.exitCode === 0 && !result.timedOut)
    const status = operationsOk && testsOk && patchVerification.ok ? 'passed' : 'failed'
    return { fixtureId: fixture.id, title: fixture.title, workspaceRoot: root, status, operationResults, testResults, patchVerification, startedAtMs, completedAtMs: Date.now() }
  }
}

function toToolRequest(operation: CodeTaskOperation): ToolRuntimeRequest {
  if (operation.type === 'write') return { toolName: 'file_write', approvalPolicy: 'trusted', input: { path: operation.path, content: operation.content } }
  if (operation.type === 'patch') return { toolName: 'apply_patch', approvalPolicy: 'trusted', input: { path: operation.path, search: operation.search, replace: operation.replace } }
  return { toolName: 'shell', approvalPolicy: 'trusted', input: { command: operation.command, args: operation.args ?? [], timeoutMs: operation.timeoutMs ?? 5000 } }
}

async function writeSeedFile(root: string, path: string, content: string): Promise<void> {
  const target = resolve(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_') || 'fixture'
}


