import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { GUI_BENCHMARK_TYPES, type GuiBenchmarkManifest, type GuiBenchmarkManifestEntry, type GuiBenchmarkMode, type GuiBenchmarkScenario, type GuiBenchmarkType } from './GuiBenchmarkTypes.js'

const benchmarkTypes = new Set<string>(GUI_BENCHMARK_TYPES)
const modes = new Set<GuiBenchmarkMode>(['mock', 'real_dingxu'])

export class GuiBenchmarkScenarioLoader {
  async loadManifest(manifestPath: string): Promise<{ manifest: GuiBenchmarkManifest; scenarios: { scenario: GuiBenchmarkScenario; scenarioPath: string }[] }> {
    const resolvedManifestPath = resolve(manifestPath)
    const parsed = await readJson(resolvedManifestPath)
    const manifest = normalizeManifest(parsed, resolvedManifestPath)
    const manifestDir = dirname(resolvedManifestPath)
    const scenarios = []
    for (const entry of manifest.scenarios) {
      const scenarioPath = resolveScenarioPath(manifestDir, entry)
      const scenario = await this.loadScenario(scenarioPath, entry)
      scenarios.push({ scenario, scenarioPath })
    }
    return { manifest, scenarios }
  }

  async loadScenario(scenarioPath: string, entry?: GuiBenchmarkManifestEntry): Promise<GuiBenchmarkScenario> {
    const resolvedScenarioPath = resolve(scenarioPath)
    const parsed = await readJson(resolvedScenarioPath)
    const scenario = normalizeScenario(parsed, resolvedScenarioPath, entry)
    if (entry && scenario.id !== entry.id) throw new Error(`Scenario ${resolvedScenarioPath} id ${scenario.id} does not match manifest id ${entry.id}`)
    return scenario
  }
}

function normalizeManifest(value: unknown, manifestPath: string): GuiBenchmarkManifest {
  const object = asObject(value, `GUI benchmark manifest ${manifestPath}`)
  if (object.schemaVersion !== 1) throw new Error(`Unsupported GUI benchmark manifest schemaVersion in ${manifestPath}`)
  if (typeof object.name !== 'string' || object.name.trim() === '') throw new Error(`GUI benchmark manifest ${manifestPath} requires name`)
  if (!Array.isArray(object.scenarios)) throw new Error(`GUI benchmark manifest ${manifestPath} requires scenarios[]`)
  return {
    schemaVersion: 1,
    name: object.name,
    description: optionalString(object.description),
    scenarios: object.scenarios.map((entry, index) => normalizeManifestEntry(entry, index, manifestPath)),
  }
}

function normalizeManifestEntry(value: unknown, index: number, manifestPath: string): GuiBenchmarkManifestEntry {
  const object = asObject(value, `GUI benchmark manifest entry ${index}`)
  const id = requiredSafeId(object.id, `scenarios[${index}].id`, manifestPath)
  return {
    id,
    title: requiredString(object.title, `scenarios[${index}].title`, manifestPath),
    scenario: requiredString(object.scenario, `scenarios[${index}].scenario`, manifestPath),
    mode: optionalMode(object.mode, `scenarios[${index}].mode`, manifestPath),
    tags: optionalStringArray(object.tags, `scenarios[${index}].tags`, manifestPath),
  }
}

function normalizeScenario(value: unknown, scenarioPath: string, entry?: GuiBenchmarkManifestEntry): GuiBenchmarkScenario {
  const object = asObject(value, `GUI benchmark scenario ${scenarioPath}`)
  if (object.schemaVersion !== 1) throw new Error(`Unsupported GUI benchmark scenario schemaVersion in ${scenarioPath}`)
  const mode = optionalMode(object.mode, 'mode', scenarioPath) ?? entry?.mode ?? 'mock'
  return {
    schemaVersion: 1,
    id: requiredSafeId(object.id, 'id', scenarioPath),
    title: requiredString(object.title, 'title', scenarioPath),
    description: requiredString(object.description, 'description', scenarioPath),
    type: requiredBenchmarkType(object.type, 'type', scenarioPath),
    mode,
    action: object.action === undefined ? undefined : asObject(object.action, `action in ${scenarioPath}`) as GuiBenchmarkScenario['action'],
    expectations: object.expectations === undefined ? undefined : asObject(object.expectations, `expectations in ${scenarioPath}`) as GuiBenchmarkScenario['expectations'],
    mock: object.mock === undefined ? undefined : asObject(object.mock, `mock in ${scenarioPath}`) as GuiBenchmarkScenario['mock'],
    tags: optionalStringArray(object.tags, 'tags', scenarioPath),
  }
}

function resolveScenarioPath(manifestDir: string, entry: GuiBenchmarkManifestEntry): string {
  const scenarioPath = resolve(manifestDir, entry.scenario)
  const rel = relative(manifestDir, scenarioPath)
  if (rel.startsWith('..') || rel === '') throw new Error(`GUI benchmark scenario for ${entry.id} must stay under ${manifestDir}`)
  return scenarioPath
}

function requiredBenchmarkType(value: unknown, field: string, path: string): GuiBenchmarkType {
  if (typeof value !== 'string' || !benchmarkTypes.has(value)) throw new Error(`${field} has invalid GUI benchmark type in ${path}`)
  return value as GuiBenchmarkType
}

function optionalMode(value: unknown, field: string, path: string): GuiBenchmarkMode | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !modes.has(value as GuiBenchmarkMode)) throw new Error(`${field} has invalid GUI benchmark mode in ${path}`)
  return value as GuiBenchmarkMode
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required in ${path}`)
  return value
}

function requiredSafeId(value: unknown, field: string, path: string): string {
  const id = requiredString(value, field, path)
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(id)) throw new Error(`${field} has invalid id in ${path}: ${id}`)
  return id
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(value: unknown, field: string, path: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${field} must be a string array in ${path}`)
  return value
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as unknown
}
