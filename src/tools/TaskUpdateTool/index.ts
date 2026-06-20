import { createStructuredErrorResult, createTextResult, type ToolDefinition } from '../../Tool.js'
import { LocalTaskStore, type TaskStatus } from '../../tasks/index.js'
import { optionalString, requiredString } from '../shared/index.js'

export const TaskUpdateTool: ToolDefinition = {
  name: 'task_update',
  description: 'Update task status or summary for a persistent Pando background task.',
  safety: 'workspace_write',
  platforms: ['all'],
  behavior: { reads: true, writes: true },
  concurrency: 'serial',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'stopped'] },
      summary: { type: 'string' },
    },
    required: ['taskId'],
  },
  async execute(toolUse, context) {
    try {
      const status = optionalTaskStatus(toolUse.input.status)
      const summary = optionalString(toolUse.input, 'summary')
      if (!status && summary === undefined) throw new Error('status or summary must be provided')
      const task = await new LocalTaskStore(context.cwd).updateTask(requiredString(toolUse.input, 'taskId'), { status, summary })
      return createTextResult(toolUse.id, JSON.stringify(task, null, 2), true, { taskId: task.taskId, status: task.status })
    } catch (error) {
      return createStructuredErrorResult(toolUse.id, error, { toolName: 'task_update' })
    }
  },
}

function optionalTaskStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) return undefined
  if (value === 'queued' || value === 'running' || value === 'completed' || value === 'failed' || value === 'stopped') return value
  throw new Error('status must be queued, running, completed, failed, or stopped')
}
