import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import {
  loadProjectConfig,
  parseProjectConfig,
  resolveDefaultModel,
  type ConfigLoadResult,
  type ProjectConfig,
} from '../config/index.js'
import { resolveAuth } from '../llm/auth.js'
import { LocalThreadStore } from '../threadStore/index.js'
import { createDefaultToolRegistry } from '../../tools.js'

export type PreflightStatus = 'passed' | 'failed' | 'warning'

export type PreflightCheck = {
  id: string
  label: string
  status: PreflightStatus
  message?: string
  detail?: unknown
}

export type PreflightReport = {
  ok: boolean
  cwd: string
  configPath?: string
  model?: {
    provider: string
    name: string
  }
  checks: PreflightCheck[]
}

export type RuntimeConfigResult = {
  config: ProjectConfig
  configPath?: string
}

export async function loadRuntimeConfig(cwd: string, configPath?: string): Promise<RuntimeConfigResult> {
  if (configPath) {
    const absolutePath = isAbsolute(configPath) ? resolve(configPath) : resolve(cwd, configPath)
    return {
      config: parseProjectConfig(await readFile(absolutePath, 'utf8'), absolutePath),
      configPath: absolutePath,
    }
  }

  const result = await loadProjectConfig(cwd, readOptionalFile)
  return {
    config: result?.config ?? {},
    configPath: result?.path,
  }
}

export async function runPreflight(input: {
  cwd: string
  configPath?: string
  includeMcp?: boolean
}): Promise<PreflightReport> {
  const cwd = resolve(input.cwd)
  const checks: PreflightCheck[] = []
  let loaded: RuntimeConfigResult | undefined
  let model: PreflightReport['model']

  checks.push(checkNodeVersion())
  checks.push(await checkCwd(cwd))

  try {
    loaded = await loadRuntimeConfig(cwd, input.configPath)
    checks.push({
      id: 'config',
      label: 'Project config',
      status: 'passed',
      message: loaded.configPath ? `Loaded ${loaded.configPath}` : 'No config file found; using defaults.',
    })
  } catch (error) {
    checks.push({
      id: 'config',
      label: 'Project config',
      status: 'failed',
      message: errorMessage(error),
    })
  }

  if (loaded) {
    try {
      const resolvedModel = resolveDefaultModel(loaded.config)
      model = {
        provider: resolvedModel.provider.id,
        name: resolvedModel.model ?? resolvedModel.provider.defaultModel,
      }
      checks.push({
        id: 'model',
        label: 'Default model',
        status: 'passed',
        message: `${model.provider}/${model.name}`,
      })

      const auth = resolveAuth(resolvedModel.provider.auth, false)
      checks.push({
        id: 'model_auth',
        label: 'Model auth',
        status: auth.missingEnv?.length ? 'failed' : 'passed',
        message: auth.missingEnv?.length
          ? `Missing auth token. Set one of: ${auth.missingEnv.join(', ')}`
          : `Auth available${auth.source ? ` from ${auth.source}` : '.'}`,
        detail: auth.missingEnv,
      })
    } catch (error) {
      checks.push({
        id: 'model',
        label: 'Default model',
        status: 'failed',
        message: errorMessage(error),
      })
    }
  }

  checks.push(await checkThreadStore(cwd))
  checks.push(checkDefaultTools())

  const ok = checks.every(check => check.status !== 'failed')
  return {
    ok,
    cwd,
    configPath: loaded?.configPath,
    model,
    checks,
  }
}

export function formatPreflightReport(report: PreflightReport): string {
  const lines = [
    report.ok ? 'Pando doctor: ok' : 'Pando doctor: failed',
    `cwd: ${report.cwd}`,
    `config: ${report.configPath ?? 'default'}`,
    `model: ${report.model ? `${report.model.provider}/${report.model.name}` : 'unknown'}`,
    '',
  ]
  for (const check of report.checks) {
    lines.push(`${statusIcon(check.status)} ${check.label}: ${check.message ?? check.status}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

function checkNodeVersion(): PreflightCheck {
  const version = runtimeNodeVersion()
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10)
  return {
    id: 'node',
    label: 'Node.js',
    status: major >= 18 ? 'passed' : 'failed',
    message: `v${version}`,
  }
}

async function checkCwd(cwd: string): Promise<PreflightCheck> {
  try {
    await stat(cwd)
    return {
      id: 'cwd',
      label: 'Working directory',
      status: 'passed',
      message: cwd,
    }
  } catch (error) {
    return {
      id: 'cwd',
      label: 'Working directory',
      status: 'failed',
      message: errorMessage(error),
    }
  }
}

async function checkThreadStore(cwd: string): Promise<PreflightCheck> {
  const store = new LocalThreadStore(cwd)
  const testPath = resolve(store.root, `.preflight_${Date.now()}_${shortId()}.tmp`)
  try {
    await mkdir(dirname(testPath), { recursive: true })
    await writeFile(testPath, 'ok', 'utf8')
    await rm(testPath, { force: true })
    assertInside(cwd, testPath)
    return {
      id: 'thread_store',
      label: 'Thread store',
      status: 'passed',
      message: store.root,
    }
  } catch (error) {
    return {
      id: 'thread_store',
      label: 'Thread store',
      status: 'failed',
      message: errorMessage(error),
    }
  }
}

function checkDefaultTools(): PreflightCheck {
  const registry = createDefaultToolRegistry()
  return {
    id: 'tools',
    label: 'Default tools',
    status: registry.tools.length > 0 ? 'passed' : 'failed',
    message: registry.names().join(', '),
  }
}

function runtimeNodeVersion(): string {
  const runtime = globalThis as unknown as { process?: { versions?: { node?: string } } }
  return runtime.process?.versions?.node ?? '0.0.0'
}

function statusIcon(status: PreflightStatus): string {
  switch (status) {
    case 'passed':
      return 'PASS'
    case 'warning':
      return 'WARN'
    case 'failed':
      return 'FAIL'
  }
}

function assertInside(rootPath: string, targetPath: string): void {
  const rel = relative(resolve(rootPath), resolve(targetPath))
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path is outside workspace: ${targetPath}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}
