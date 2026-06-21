import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { validateEventEnvelope, type EventEnvelope } from '../protocol/index.js'
import type {
  GoldenTrace,
  GoldenTraceExpectedGraphSummary,
  GoldenTraceExpectedIncident,
  GoldenTraceExpectedReportShape,
} from './GoldenTraceTypes.js'

declare const process: { cwd(): string }

export const GOLDEN_TRACE_FILE_NAMES = [
  'events.jsonl',
  'expected-report-shape.json',
  'expected-incidents.json',
  'expected-graph-summary.json',
  'artifacts-manifest.json',
  'README.md',
] as const

export type LoadGoldenTraceOptions = {
  allowMissingExpected?: boolean
}

export function defaultGoldenTraceRoot(cwd = process.cwd()): string {
  return resolve(cwd, 'golden-traces')
}

export async function listGoldenTraceDirs(root = defaultGoldenTraceRoot()): Promise<string[]> {
  const names = await readdir(root)
  const dirs: string[] = []
  for (const name of names) {
    const path = join(root, name)
    if ((await stat(path)).isDirectory()) dirs.push(path)
  }
  return dirs.sort((left, right) => left.localeCompare(right))
}

export async function loadAllGoldenTraces(root = defaultGoldenTraceRoot(), options: LoadGoldenTraceOptions = {}): Promise<GoldenTrace[]> {
  const dirs = await listGoldenTraceDirs(root)
  return Promise.all(dirs.map(dir => loadGoldenTrace(dir, options)))
}

export async function loadGoldenTrace(traceDir: string, options: LoadGoldenTraceOptions = {}): Promise<GoldenTrace> {
  const dir = resolve(traceDir)
  const events = parseEventsJsonl(await readRequired(join(dir, 'events.jsonl')))
  const expectedReportShape = await readJson<GoldenTraceExpectedReportShape>(join(dir, 'expected-report-shape.json'), {}, options)
  const expectedIncidents = await readJson<GoldenTraceExpectedIncident[]>(join(dir, 'expected-incidents.json'), [], options)
  const expectedGraphSummary = await readJson<GoldenTraceExpectedGraphSummary>(join(dir, 'expected-graph-summary.json'), {}, options)
  const artifactsManifest = await readJson(join(dir, 'artifacts-manifest.json'), { artifacts: [], warnings: [] }, options)
  const readme = (await readText(join(dir, 'README.md'), '', options)) ?? ''
  return {
    name: basename(dir),
    traceDir: dir,
    events,
    expectedReportShape,
    expectedIncidents,
    expectedGraphSummary,
    artifactsManifest,
    readme,
  }
}

function parseEventsJsonl(content: string): EventEnvelope[] {
  const events: EventEnvelope[] = []
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error('Invalid events.jsonl line ' + (index + 1) + ': ' + errorMessage(error))
    }
    validateEventEnvelope(parsed)
    events.push(parsed)
  }
  return events
}

async function readJson<T>(path: string, fallback: T, options: LoadGoldenTraceOptions): Promise<T> {
  const text = await readText(path, undefined, options)
  if (text === undefined) return fallback
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error('Invalid JSON in ' + path + ': ' + errorMessage(error))
  }
}

async function readText(path: string, fallback: string | undefined, options: LoadGoldenTraceOptions): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (options.allowMissingExpected && isNotFound(error)) return fallback
    throw error
  }
}

async function readRequired(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
