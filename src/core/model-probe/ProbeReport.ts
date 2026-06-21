import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ModelProbeReportFiles, ModelProbeRun } from './ModelProbeTypes.js'

export class ProbeReport {
  static filesFor(outputDir: string): ModelProbeReportFiles {
    const resolved = resolve(outputDir)
    return {
      jsonPath: join(resolved, 'model-probe-result.json'),
      markdownPath: join(resolved, 'model-probe-report.md'),
      jsonlPath: join(resolved, 'model-probe-runs.jsonl'),
    }
  }

  static async write(run: ModelProbeRun, outputDir: string): Promise<ModelProbeReportFiles> {
    const files = ProbeReport.filesFor(outputDir)
    const safeRun = redactProbeValue(run)
    await mkdir(outputDir, { recursive: true })
    await writeFile(files.jsonPath, `${JSON.stringify({ summary: safeRun.summary, run: safeRun }, null, 2)}\n`, 'utf8')
    await writeFile(files.markdownPath, ProbeReport.toMarkdown(safeRun), 'utf8')
    return files
  }

  static toMarkdown(run: ModelProbeRun): string {
    const safeRun = redactProbeValue(run)
    const lines = [
      '# Model Production Probes Report',
      '',
      `Status: ${safeRun.summary.status}`,
      `Mode: ${safeRun.mode}`,
      `Online enabled: ${safeRun.onlineEnabled}`,
      `Run ID: ${safeRun.runId}`,
      `Workspace: ${safeRun.workspaceId}`,
      '',
      '## Summary',
      '',
      `Total: ${safeRun.summary.total}`,
      `Passed: ${safeRun.summary.passed}`,
      `Skipped: ${safeRun.summary.skipped}`,
      `Missing auth: ${safeRun.summary.missingAuth}`,
      `Degraded: ${safeRun.summary.degraded}`,
      `Failed: ${safeRun.summary.failed}`,
      '',
      '## Partials',
      '',
      ...(safeRun.partials.length ? safeRun.partials.map(partial => `- ${partial}`) : ['- none']),
      '',
      '## Providers',
      '',
      '| Provider | Configured | Auth state | Cost | Latency | Region |',
      '| --- | --- | --- | --- | --- | --- |',
      ...safeRun.providers.map(provider => `| ${cell(provider.providerId)} | ${provider.configured} | ${provider.authState} | ${provider.costClass} | ${provider.latencyClass} | ${provider.region} |`),
      '',
      '## Models',
      '',
      '| Provider | Model | Tools | Vision | Reasoning | Context | Cost |',
      '| --- | --- | --- | --- | --- | ---: | --- |',
      ...safeRun.models.map(model => `| ${cell(model.providerId)} | ${cell(model.modelId)} | ${model.tools} | ${model.vision} | ${model.reasoning} | ${model.contextWindowTokens} | ${model.costClass} |`),
      '',
      '## Fallback Chain',
      '',
      ...(safeRun.fallbackChain.length
        ? safeRun.fallbackChain.map(step => `- ${step.order}. ${step.role}: ${step.providerId}/${step.modelId} health=${step.health}`)
        : ['- none']),
      '',
      '## Probe Results',
      '',
      '| Type | Status | Message |',
      '| --- | --- | --- |',
      ...safeRun.results.map(result => `| ${result.type} | ${result.status} | ${cell(result.message)} |`),
      '',
    ]
    return `${redactProbeText(lines.join('\n'))}\n`
  }
}

export function redactProbeValue<T>(value: T): T {
  return redactValue(value) as T
}

export function redactProbeText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer <redacted>')
    .replace(/(api[_-]?key|token|secret|authorization|credential|password)\s*[:=]\s*[^\s,;|]+/gi, '$1=<redacted>')
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactProbeText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') return value
  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? '<redacted>' : redactValue(item)
  }
  return redacted
}

function isSecretKey(key: string): boolean {
  return /(^|[_-])(api[_-]?key|token|secret|authorization|credential|password)s?$/i.test(key)
}

function cell(value: string): string {
  return redactProbeText(value).replace(/\|/g, '\\|')
}
