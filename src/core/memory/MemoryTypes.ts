export type MemoryScope = 'session' | 'goal' | 'loop' | 'skill' | 'user' | 'project'

export type MemoryRecord = {
  memoryId: string
  scope: MemoryScope
  content: string
  tags: string[]
  source?: string
  threadId?: string
  goalId?: string
  loopId?: string
  createdAtMs: number
  redacted: boolean
}

export type MemoryQuery = {
  scope?: MemoryScope
  tags?: string[]
  source?: string
  threadId?: string
  goalId?: string
  loopId?: string
  limit?: number
}
