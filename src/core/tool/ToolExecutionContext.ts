import type { DurableRuntime } from '../durable/index.js'
import type { GuiRuntime } from '../gui/index.js'
export type ToolExecutionContext = { workspaceRoot: string; workspaceId?: string; runId?: string; loopId?: string; goalId?: string; taskId?: string; durable?: DurableRuntime; guiRuntime?: GuiRuntime; resultRoot?: string }
