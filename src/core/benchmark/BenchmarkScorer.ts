import type { BenchmarkCaseResult, BenchmarkExpectation, BenchmarkExpectationResult, BenchmarkFixture, JsonObject, JsonValue } from './BenchmarkTypes.js'

export class BenchmarkScorer {
  score(fixture: BenchmarkFixture): BenchmarkCaseResult {
    const expectationResults = fixture.expectations.map(expectation => this.scoreExpectation(fixture, expectation))
    const score = expectationResults.reduce((total, result) => total + (result.passed ? result.weight : 0), 0)
    const maxScore = expectationResults.reduce((total, result) => total + result.weight, 0)
    return {
      id: fixture.id,
      category: fixture.category,
      title: fixture.title,
      status: score === maxScore ? 'passed' : 'failed',
      score,
      maxScore,
      expectationResults,
    }
  }

  private scoreExpectation(fixture: BenchmarkFixture, expectation: BenchmarkExpectation): BenchmarkExpectationResult {
    const root: JsonObject = {
      id: fixture.id,
      category: fixture.category,
      title: fixture.title,
      task: fixture.task,
      input: fixture.input,
      output: fixture.output,
    }
    const actual = readPath(root, expectation.path)
    const passed = evaluate(actual, expectation)
    return {
      name: expectation.name,
      path: expectation.path,
      operator: expectation.operator,
      passed,
      weight: expectation.weight ?? 1,
      expected: expectation.value,
      actual,
      message: passed ? 'passed' : failureMessage(actual, expectation),
    }
  }
}

function readPath(root: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = root
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = current[part]
  }
  return current
}

function evaluate(actual: JsonValue | undefined, expectation: BenchmarkExpectation): boolean {
  if (expectation.operator === 'exists') return actual !== undefined
  if (expectation.operator === 'equals') return deepEqual(actual, expectation.value)
  if (expectation.operator === 'contains') return contains(actual, expectation.value)
  if (expectation.operator === 'not_contains') return !contains(actual, expectation.value)
  if (expectation.operator === 'array_contains') return Array.isArray(actual) && actual.some(item => deepEqual(item, expectation.value))
  if (expectation.operator === 'numeric_gte') return typeof actual === 'number' && typeof expectation.value === 'number' && actual >= expectation.value
  return false
}

function contains(actual: JsonValue | undefined, expected: JsonValue | undefined): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected)
  if (Array.isArray(actual)) return actual.some(item => deepEqual(item, expected))
  if (actual !== undefined && typeof expected === 'string') return JSON.stringify(actual).includes(expected)
  return false
}

function deepEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function failureMessage(actual: JsonValue | undefined, expectation: BenchmarkExpectation): string {
  return `Expected ${expectation.path} ${expectation.operator} ${JSON.stringify(expectation.value)} but received ${JSON.stringify(actual)}`
}
