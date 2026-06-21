import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { MemoryQuery, MemoryRecord, MemoryScope } from './MemoryTypes.js'

let memoryCounter = 0

export class MemoryStore {
  constructor(readonly path = '.pandoshare/memory/memory.jsonl') {}

  async append(input: Omit<MemoryRecord, 'memoryId' | 'createdAtMs' | 'redacted'> & { memoryId?: string; createdAtMs?: number }): Promise<MemoryRecord> {
    memoryCounter += 1
    const content = redactMemorySecrets(input.content)
    const record: MemoryRecord = {
      ...input,
      memoryId: input.memoryId ?? 'memory_' + Date.now().toString(36) + '_' + memoryCounter,
      content,
      createdAtMs: input.createdAtMs ?? Date.now(),
      redacted: content !== input.content,
    }
    const target = resolve(this.path)
    await mkdir(dirname(target), { recursive: true })
    await appendFile(target, JSON.stringify(record) + '\n', 'utf8')
    return record
  }

  async read(query: MemoryQuery = {}): Promise<MemoryRecord[]> {
    const records = await this.readAll()
    const filtered = records.filter(record => matches(record, query))
    return filtered.slice(0, query.limit ?? filtered.length)
  }

  async latest(query: MemoryQuery = {}): Promise<MemoryRecord | undefined> {
    return (await this.read(query)).sort((left, right) => right.createdAtMs - left.createdAtMs)[0]
  }

  async latestProjection(): Promise<Record<MemoryScope, MemoryRecord[]>> {
    const projection = { session: [], goal: [], loop: [], skill: [], user: [], project: [] } as Record<MemoryScope, MemoryRecord[]>
    for (const record of await this.readAll()) projection[record.scope].push(record)
    return projection
  }

  private async readAll(): Promise<MemoryRecord[]> {
    try {
      const text = await readFile(resolve(this.path), 'utf8')
      return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as MemoryRecord)
    } catch {
      return []
    }
  }
}

function matches(record: MemoryRecord, query: MemoryQuery): boolean {
  if (query.scope && record.scope !== query.scope) return false
  if (query.source && record.source !== query.source) return false
  if (query.threadId && record.threadId !== query.threadId) return false
  if (query.goalId && record.goalId !== query.goalId) return false
  if (query.loopId && record.loopId !== query.loopId) return false
  if (query.tags?.length && !query.tags.every(tag => record.tags.includes(tag))) return false
  return true
}

export function redactMemorySecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{12,}/g, '<redacted>').replace(/(token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
}

