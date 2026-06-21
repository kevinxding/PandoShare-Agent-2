import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { BenchmarkManifestLoader } from './BenchmarkManifestLoader.js'
import type {
  BenchmarkCase,
  BenchmarkCategory,
  BenchmarkExpectation,
  BenchmarkExpectationOperator,
  BenchmarkFixture,
  BenchmarkManifest,
  BenchmarkManifestEntry,
  JsonObject,
  JsonValue,
} from './BenchmarkTypes.js'

const operators = new Set<BenchmarkExpectationOperator>(['equals', 'contains', 'not_contains', 'array_contains', 'exists', 'numeric_gte'])
const categories = new Set<BenchmarkCategory>(['code', 'loop', 'gateway', 'gui', 'replay', 'model'])

export class BenchmarkFixtureLoader {
  constructor(readonly manifestLoader = new BenchmarkManifestLoader()) {}

  async loadCases(manifestPath: string): Promise<{ manifest: BenchmarkManifest; cases: BenchmarkCase[] }> {
    const manifest = await this.manifestLoader.load(manifestPath)
    const manifestDir = dirname(resolve(manifestPath))
    const cases: BenchmarkCase[] = []
    for (const entry of manifest.benchmarks) {
      const fixturePath = resolveFixturePath(manifestDir, entry)
      const fixture = await this.loadFixture(fixturePath)
      if (fixture.id !== entry.id) throw new Error(`Fixture ${fixturePath} id ${fixture.id} does not match manifest id ${entry.id}`)
      if (fixture.category !== entry.category) throw new Error(`Fixture ${fixturePath} category ${fixture.category} does not match manifest category ${entry.category}`)
      cases.push({ manifestEntry: entry, fixture, fixturePath })
    }
    return { manifest, cases }
  }

  async loadFixture(fixturePath: string): Promise<BenchmarkFixture> {
    const raw = await readFile(resolve(fixturePath), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeFixture(parsed, fixturePath)
  }
}

function resolveFixturePath(manifestDir: string, entry: BenchmarkManifestEntry): string {
  const fixturePath = resolve(manifestDir, entry.fixture)
  const rel = relative(manifestDir, fixturePath)
  if (rel.startsWith('..') || rel === '') throw new Error(`Benchmark fixture for ${entry.id} must stay under ${manifestDir}`)
  return fixturePath
}

function normalizeFixture(value: unknown, fixturePath: string): BenchmarkFixture {
  const object = asObject(value, `Benchmark fixture ${fixturePath}`)
  const category = requiredCategory(object.category, 'category', fixturePath)
  const input = asJsonObject(object.input, `input in ${fixturePath}`)
  const output = asJsonObject(object.output, `output in ${fixturePath}`)
  if (!Array.isArray(object.expectations) || object.expectations.length === 0) throw new Error(`Fixture ${fixturePath} requires expectations[]`)
  return {
    id: requiredSafeId(object.id, 'id', fixturePath),
    category,
    title: requiredString(object.title, 'title', fixturePath),
    description: requiredString(object.description, 'description', fixturePath),
    task: requiredString(object.task, 'task', fixturePath),
    input,
    output,
    expectations: object.expectations.map((expectation, index) => normalizeExpectation(expectation, index, fixturePath)),
    tags: optionalStringArray(object.tags, 'tags', fixturePath),
  }
}

function normalizeExpectation(value: unknown, index: number, fixturePath: string): BenchmarkExpectation {
  const object = asObject(value, `Expectation ${index} in ${fixturePath}`)
  const operator = requiredOperator(object.operator, `expectations[${index}].operator`, fixturePath)
  const expectation: BenchmarkExpectation = {
    name: requiredString(object.name, `expectations[${index}].name`, fixturePath),
    path: requiredString(object.path, `expectations[${index}].path`, fixturePath),
    operator,
    weight: optionalWeight(object.weight, `expectations[${index}].weight`, fixturePath),
  }
  if (object.value !== undefined) expectation.value = object.value as JsonValue
  return expectation
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function asJsonObject(value: unknown, label: string): JsonObject {
  return asObject(value, label) as JsonObject
}

function requiredString(value: unknown, field: string, fixturePath: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required in ${fixturePath}`)
  return value
}

function requiredSafeId(value: unknown, field: string, fixturePath: string): string {
  const id = requiredString(value, field, fixturePath)
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(id)) throw new Error(`${field} has invalid benchmark id in ${fixturePath}: ${id}`)
  return id
}

function requiredCategory(value: unknown, field: string, fixturePath: string): BenchmarkCategory {
  if (typeof value !== 'string' || !categories.has(value as BenchmarkCategory)) throw new Error(`${field} has invalid category in ${fixturePath}`)
  return value as BenchmarkCategory
}

function requiredOperator(value: unknown, field: string, fixturePath: string): BenchmarkExpectationOperator {
  if (typeof value !== 'string' || !operators.has(value as BenchmarkExpectationOperator)) throw new Error(`${field} has invalid operator in ${fixturePath}`)
  return value as BenchmarkExpectationOperator
}

function optionalWeight(value: unknown, field: string, fixturePath: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || value <= 0) throw new Error(`${field} must be a positive number in ${fixturePath}`)
  return value
}

function optionalStringArray(value: unknown, field: string, fixturePath: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${field} must be a string array in ${fixturePath}`)
  return value
}
