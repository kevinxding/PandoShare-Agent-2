import type { ToolUse } from '../../Tool.js'

export type ToolHookEvent = {
  phase: 'before' | 'after' | 'error'
  toolUse: ToolUse
  message?: string
}

export type ToolHook = (event: ToolHookEvent) => void | Promise<void>

