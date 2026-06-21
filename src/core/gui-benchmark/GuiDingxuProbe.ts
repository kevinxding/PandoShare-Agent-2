import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ProjectConfig, McpServerConfig } from '../../services/config/index.js'
import { createGuiBackendFromMcpConnections, diagnoseGuiBackend, formatGuiDoctorReport } from '../../services/gui/index.js'
import { closeMcpConnections, connectConfiguredMcpServers } from '../../services/mcp/index.js'
import type { GuiDingxuProbeResult } from './GuiBenchmarkTypes.js'

type RuntimeEnv = { process?: { env?: Record<string, string | undefined> } }

export type GuiDingxuProbeOptions = {
  workspaceRoot: string
  configPath?: string
  env?: Record<string, string | undefined>
}

export class GuiDingxuProbe {
  async probe(options: GuiDingxuProbeOptions): Promise<GuiDingxuProbeResult> {
    const startedAtMs = Date.now()
    const env = options.env ?? (globalThis as unknown as RuntimeEnv).process?.env ?? {}
    if (env.PANDO_GUI_REAL !== '1') {
      return {
        status: 'skipped',
        code: 'skipped_real_gui',
        durationMs: Date.now() - startedAtMs,
        message: 'Real Dingxu GUI probe skipped because PANDO_GUI_REAL=1 is not set.',
        eventIds: [],
        screenshotRefs: [],
      }
    }

    try {
      const configPath = resolve(options.configPath ?? resolve(options.workspaceRoot, 'pandoshare.config.json'))
      const config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')) as { mcpServers?: Record<string, unknown> }
      const dingxuServer = parseMcpServerConfig(config.mcpServers?.dingxu_gui)
      if (!dingxuServer) {
        return {
          status: 'partial',
          code: 'backend_missing',
          durationMs: Date.now() - startedAtMs,
          message: 'PANDO_GUI_REAL=1 is set, but mcpServers.dingxu_gui is not configured.',
          eventIds: [],
          screenshotRefs: [],
        }
      }

      const projectConfig: ProjectConfig = { mcpServers: { dingxu_gui: dingxuServer } }
      const connections = await connectConfiguredMcpServers(projectConfig)
      try {
        const backend = createGuiBackendFromMcpConnections(connections)
        const report = diagnoseGuiBackend(backend)
        const diagnostic = formatGuiDoctorReport(report)
        return {
          status: report.dingxu.ok ? 'passed' : 'partial',
          code: report.dingxu.ok ? 'ok' : 'backend_missing',
          durationMs: Date.now() - startedAtMs,
          message: report.dingxu.message,
          eventIds: [],
          screenshotRefs: [],
          diagnostic,
        }
      } finally {
        closeMcpConnections(connections)
      }
    } catch (error) {
      return {
        status: 'failed',
        code: 'probe_failed',
        durationMs: Date.now() - startedAtMs,
        message: error instanceof Error ? error.message : String(error),
        eventIds: [],
        screenshotRefs: [],
      }
    }
  }
}

function parseMcpServerConfig(value: unknown): McpServerConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.command !== 'string' || record.command.length === 0) return undefined
  const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === 'string') : undefined
  const startupTimeoutSec = typeof record.startupTimeoutSec === 'number'
    ? record.startupTimeoutSec
    : typeof record.startup_timeout_sec === 'number'
      ? record.startup_timeout_sec
      : undefined
  return { command: record.command, args, startupTimeoutSec }
}
