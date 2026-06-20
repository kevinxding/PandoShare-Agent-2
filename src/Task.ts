export type TaskType =
  | 'local_shell'
  | 'local_agent'
  | 'gui_action'
  | 'browser'
  | 'mcp_monitor'
  | 'workflow'

export type TaskStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'killed'

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

export type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  totalPausedMs?: number
  outputPath?: string
  outputOffset: number
  notified: boolean
}

export type TaskHandle = {
  taskId: string
  cleanup?: () => void
}

export type TaskRuntimeContext = {
  abortController: AbortController
}

export type Task = {
  name: string
  type: TaskType
  kill(taskId: string, context: TaskRuntimeContext): Promise<void>
}

const TASK_ID_PREFIXES: Record<TaskType, string> = {
  local_shell: 's',
  local_agent: 'a',
  gui_action: 'g',
  browser: 'b',
  mcp_monitor: 'm',
  workflow: 'w',
}

const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function generateTaskId(type: TaskType): string {
  const bytes = getRandomBytes(8)
  let id = TASK_ID_PREFIXES[type]
  for (const byte of bytes) {
    id += TASK_ID_ALPHABET[byte % TASK_ID_ALPHABET.length]
  }
  return id
}

export function createTaskStateBase(
  type: TaskType,
  description: string,
  options: { id?: string; toolUseId?: string; outputPath?: string } = {},
): TaskStateBase {
  return {
    id: options.id ?? generateTaskId(type),
    type,
    status: 'pending',
    description,
    toolUseId: options.toolUseId,
    startTime: Date.now(),
    outputPath: options.outputPath,
    outputOffset: 0,
    notified: false,
  }
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}
