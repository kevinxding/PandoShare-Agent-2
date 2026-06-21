import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ChaosRunReport } from './ChaosTypes.js'

export async function writeChaosReport(workspaceRoot: string, report: ChaosRunReport, outDir = 'docs/chaos'): Promise<void> {
  const dir = resolve(workspaceRoot, outDir)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'latest-smoke-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  await writeFile(resolve(dir, 'latest-smoke-report.md'), renderChaosReport(report), 'utf8')
}

export function renderChaosReport(report: ChaosRunReport): string {
  return [
    '# Chaos Smoke Report',
    '',
    '- Run: ' + report.runId,
    '- Iterations: ' + report.iterations,
    '- Recoveries: ' + report.recoveries,
    '- Failures: ' + report.failures,
    '- Incidents: ' + report.incidents,
    '',
    '## Results',
    '',
    ...report.results.map(result => '- ' + result.scenarioId + ': ' + result.status + ' - ' + result.message),
    '',
  ].join('\n')
}
