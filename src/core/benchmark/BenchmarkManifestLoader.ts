import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BenchmarkCategory, BenchmarkManifest, BenchmarkManifestEntry } from './BenchmarkTypes.js'

const categories = new Set<BenchmarkCategory>(['code', 'loop', 'gateway', 'gui', 'replay', 'model'])

export class BenchmarkManifestLoader {
  async load(manifestPath: string): Promise<BenchmarkManifest> {
    const resolvedPath = resolve(manifestPath)
    const raw = await readFile(resolvedPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeManifest(parsed, resolvedPath)
  }
}

function normalizeManifest(value: unknown, manifestPath: string): BenchmarkManifest {
  const object = asObject(value, `Benchmark manifest ${manifestPath}`)
  if (object.schemaVersion !== 1) throw new Error(`Unsupported benchmark manifest schemaVersion in ${manifestPath}`)
  if (typeof object.name !== 'string' || object.name.trim() === '') throw new Error(`Benchmark manifest ${manifestPath} requires a name`)
  if (!Array.isArray(object.benchmarks)) throw new Error(`Benchmark manifest ${manifestPath} requires benchmarks[]`)
  return {
    schemaVersion: 1,
    name: object.name,
    description: optionalString(object.description),
    benchmarks: object.benchmarks.map((entry, index) => normalizeEntry(entry, index, manifestPath)),
  }
}

function normalizeEntry(value: unknown, index: number, manifestPath: string): BenchmarkManifestEntry {
  const object = asObject(value, `Benchmark manifest entry ${index}`)
  const id = requiredSafeId(object.id, `benchmarks[${index}].id`, manifestPath)
  const category = requiredCategory(object.category, `benchmarks[${index}].category`, manifestPath)
  const title = requiredString(object.title, `benchmarks[${index}].title`, manifestPath)
  const fixture = requiredString(object.fixture, `benchmarks[${index}].fixture`, manifestPath)
  if (object.offline !== true) throw new Error(`Benchmark ${id} must declare offline: true`)
  return {
    id,
    category,
    title,
    fixture,
    tags: optionalStringArray(object.tags, `benchmarks[${index}].tags`, manifestPath),
    offline: true,
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, manifestPath: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required in ${manifestPath}`)
  return value
}

function requiredSafeId(value: unknown, field: string, manifestPath: string): string {
  const id = requiredString(value, field, manifestPath)
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(id)) throw new Error(`${field} has invalid benchmark id: ${id}`)
  return id
}

function requiredCategory(value: unknown, field: string, manifestPath: string): BenchmarkCategory {
  if (typeof value !== 'string' || !categories.has(value as BenchmarkCategory)) throw new Error(`${field} has invalid category in ${manifestPath}`)
  return value as BenchmarkCategory
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(value: unknown, field: string, manifestPath: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${field} must be a string array in ${manifestPath}`)
  return value
}
