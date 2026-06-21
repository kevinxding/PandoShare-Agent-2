import type { TestCommandResult } from './TestCommandRunner.js'
import type { PatchVerifierResult } from './PatchVerifier.js'
import type { ToolExecutionRecord } from '../tool/index.js'

export type CodeAgentHarnessResult = {
  fixtureId: string
  title: string
  workspaceRoot: string
  status: 'passed' | 'failed'
  operationResults: ToolExecutionRecord[]
  testResults: TestCommandResult[]
  patchVerification: PatchVerifierResult
  startedAtMs: number
  completedAtMs: number
}

export class CodeAgentReport {
  toMarkdown(result: CodeAgentHarnessResult): string {
    const lines = [
      '# Code Agent Harness Report',
      '',
      '- Fixture: ' + result.fixtureId,
      '- Title: ' + result.title,
      '- Status: ' + result.status,
      '- Workspace: ' + result.workspaceRoot,
      '- Operations: ' + result.operationResults.length,
      '- Tests: ' + result.testResults.length,
      '',
      '## Test Commands',
      '',
    ]
    for (const test of result.testResults) lines.push('- ' + test.command + ' ' + test.args.join(' ') + ': exit ' + test.exitCode)
    if (result.patchVerification.errors.length > 0) {
      lines.push('', '## Patch Verification Errors', '')
      for (const error of result.patchVerification.errors) lines.push('- ' + error)
    }
    return lines.join('\n') + '\n'
  }
}
