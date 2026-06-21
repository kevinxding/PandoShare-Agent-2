export type CodeTaskFile = {
  path: string
  content: string
}

export type CodeTaskOperation =
  | { type: 'write'; path: string; content: string }
  | { type: 'patch'; path: string; search: string; replace: string }
  | { type: 'shell'; command: string; args?: string[]; timeoutMs?: number }

export type CodeTaskVerifierCommand = {
  command: string
  args?: string[]
  timeoutMs?: number
}

export type CodeTaskVerifier = {
  commands?: CodeTaskVerifierCommand[]
  changedFiles?: string[]
  forbiddenPaths?: string[]
  mustContain?: Array<{ path: string; text: string }>
}

export type CodeTaskFixture = {
  id: string
  title: string
  description: string
  files: CodeTaskFile[]
  operations: CodeTaskOperation[]
  verifier: CodeTaskVerifier
  tags?: string[]
}

export function parseCodeTaskFixture(value: unknown): CodeTaskFixture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('fixture must be an object')
  const record = value as Record<string, unknown>
  const fixture: CodeTaskFixture = {
    id: stringField(record, 'id'),
    title: stringField(record, 'title'),
    description: stringField(record, 'description'),
    files: arrayField(record, 'files').map(parseFile),
    operations: arrayField(record, 'operations').map(parseOperation),
    verifier: parseVerifier(record.verifier),
    tags: optionalStringArray(record.tags),
  }
  return fixture
}

function parseFile(value: unknown): CodeTaskFile {
  const record = objectField(value, 'file')
  return { path: stringField(record, 'path'), content: stringField(record, 'content') }
}

function parseOperation(value: unknown): CodeTaskOperation {
  const record = objectField(value, 'operation')
  const type = stringField(record, 'type')
  if (type === 'write') return { type, path: stringField(record, 'path'), content: stringField(record, 'content') }
  if (type === 'patch') return { type, path: stringField(record, 'path'), search: stringField(record, 'search'), replace: stringField(record, 'replace') }
  if (type === 'shell') return { type, command: stringField(record, 'command'), args: optionalStringArray(record.args), timeoutMs: optionalNumber(record.timeoutMs) }
  throw new Error('unsupported operation type: ' + type)
}

function parseVerifier(value: unknown): CodeTaskVerifier {
  const record = objectField(value, 'verifier')
  return {
    commands: optionalArray(record.commands).map(parseVerifierCommand),
    changedFiles: optionalStringArray(record.changedFiles),
    forbiddenPaths: optionalStringArray(record.forbiddenPaths),
    mustContain: optionalArray(record.mustContain).map(parseMustContain),
  }
}

function parseVerifierCommand(value: unknown): CodeTaskVerifierCommand {
  const record = objectField(value, 'verifier command')
  return { command: stringField(record, 'command'), args: optionalStringArray(record.args), timeoutMs: optionalNumber(record.timeoutMs) }
}

function parseMustContain(value: unknown): { path: string; text: string } {
  const record = objectField(value, 'mustContain')
  return { path: stringField(record, 'path'), text: stringField(record, 'text') }
}

function objectField(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object')
  return value as Record<string, unknown>
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(key + ' must be a non-empty string')
  return value
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) throw new Error(key + ' must be an array')
  return value
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('expected string array')
  return value.map(item => {
    if (typeof item !== 'string') throw new Error('expected string array')
    return item
  })
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number') throw new Error('expected number')
  return value
}
