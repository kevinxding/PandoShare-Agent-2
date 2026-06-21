export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type BenchmarkCategory = 'code' | 'loop' | 'gateway' | 'gui' | 'replay' | 'model'

export type BenchmarkManifest = {
  schemaVersion: 1
  name: string
  description?: string
  benchmarks: BenchmarkManifestEntry[]
}

export type BenchmarkManifestEntry = {
  id: string
  category: BenchmarkCategory
  title: string
  fixture: string
  tags?: string[]
  offline: true
}

export type BenchmarkFixture = {
  id: string
  category: BenchmarkCategory
  title: string
  description: string
  task: string
  input: JsonObject
  output: JsonObject
  expectations: BenchmarkExpectation[]
  tags?: string[]
}

export type BenchmarkExpectationOperator = 'equals' | 'contains' | 'not_contains' | 'array_contains' | 'exists' | 'numeric_gte'

export type BenchmarkExpectation = {
  name: string
  path: string
  operator: BenchmarkExpectationOperator
  value?: JsonValue
  weight?: number
}

export type BenchmarkCase = {
  manifestEntry: BenchmarkManifestEntry
  fixture: BenchmarkFixture
  fixturePath: string
}

export type BenchmarkExpectationResult = {
  name: string
  path: string
  operator: BenchmarkExpectationOperator
  passed: boolean
  weight: number
  expected?: JsonValue
  actual?: JsonValue
  message: string
}

export type BenchmarkCaseResult = {
  id: string
  category: BenchmarkCategory
  title: string
  status: 'passed' | 'failed'
  score: number
  maxScore: number
  expectationResults: BenchmarkExpectationResult[]
}

export type BenchmarkRunFiles = {
  jsonPath: string
  markdownPath: string
  jsonlPath: string
}

export type BenchmarkRunResult = {
  runId: string
  manifestPath: string
  manifestName: string
  generatedAtMs: number
  status: 'passed' | 'failed'
  caseCount: number
  passedCount: number
  failedCount: number
  score: number
  maxScore: number
  results: BenchmarkCaseResult[]
  files?: BenchmarkRunFiles
}

export type BenchmarkReportSummary = {
  status: BenchmarkRunResult['status']
  caseCount: number
  passedCount: number
  failedCount: number
  score: number
  maxScore: number
  failedIds: string[]
}
