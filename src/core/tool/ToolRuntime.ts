import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { TOOL_EVENT_TYPES } from './ToolEventTypes.js'
import { decideToolApproval } from './ToolApprovalBridge.js'
import { ToolRuntimeError } from './ToolError.js'
import { ToolRegistryV2 } from './ToolRegistry.js'
import { classifyTool } from './ToolSideEffects.js'
import { runShellWithTimeout } from './ToolTimeout.js'
import { simpleHash, storeToolResultRef } from './ToolResultRef.js'
import type { ApplyPatchInput, FileHashSnapshot, FileReadInput, FileWriteInput, GuiToolInput, ShellInput, ToolExecutionRecord, ToolExecutionResult, ToolRuntimeRequest } from './ToolTypes.js'
import type { ToolExecutionContext } from './ToolExecutionContext.js'

let callCounter = 0

export class ToolRuntime {
  constructor(private readonly context: ToolExecutionContext, private readonly registry = new ToolRegistryV2()) {}

  async execute(request: ToolRuntimeRequest): Promise<ToolExecutionRecord> {
    callCounter += 1
    const toolCallId = request.toolCallId ?? 'tool_' + Date.now().toString(36) + '_' + callCounter
    const identity = { workspaceId: this.context.workspaceId ?? 'default', toolCallId, toolName: request.toolName, runId: request.runId ?? this.context.runId, loopId: request.loopId ?? this.context.loopId, goalId: request.goalId ?? this.context.goalId, taskId: request.taskId ?? this.context.taskId, parentEventId: request.parentEventId, createdAtMs: Date.now() }
    const eventIds: string[] = []
    await this.emit(TOOL_EVENT_TYPES.requested, identity, eventIds)
    const metadata = this.registry.get(request.toolName)
    if (!metadata) throw new ToolRuntimeError('unknown_tool', 'Unknown tool: ' + request.toolName)
    const classification = classifyTool(metadata)
    const approval = decideToolApproval(classification, request.approvalPolicy)
    if (approval.required) await this.emit(TOOL_EVENT_TYPES.approvalRequired, identity, eventIds)
    if (approval.status === 'waiting' || approval.status === 'rejected') return { schemaVersion: 1, identity, state: approval.status === 'rejected' ? 'rejected' : 'waiting_approval', classification, approval, eventIds, createdAtMs: identity.createdAtMs }
    await this.emit(TOOL_EVENT_TYPES.started, identity, eventIds)
    try {
      const result = await this.executeTool(request.toolName, request.input ?? {})
      const resultRef = await storeToolResultRef(this.context.resultRoot ?? this.context.workspaceRoot, toolCallId, result)
      await this.emit(TOOL_EVENT_TYPES.resultStored, identity, eventIds)
      await this.emit(TOOL_EVENT_TYPES.completed, identity, eventIds)
      return { schemaVersion: 1, identity, state: 'completed', classification, approval, result, resultRef, verification: { ok: result.ok, status: result.ok ? 'passed' : 'failed', message: result.message, fileChanges: result.fileChanges }, eventIds, createdAtMs: identity.createdAtMs, completedAtMs: Date.now() }
    } catch (error) {
      await this.emit(TOOL_EVENT_TYPES.failed, identity, eventIds)
      return { schemaVersion: 1, identity, state: 'failed', classification, approval, result: { ok: false, message: error instanceof Error ? error.message : String(error) }, verification: { ok: false, status: 'failed', message: 'tool execution failed' }, eventIds, createdAtMs: identity.createdAtMs, completedAtMs: Date.now() }
    }
  }

  private async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolExecutionResult> {
    if (toolName === 'file_read') { const file = await readFile(workspacePath(this.context.workspaceRoot, String((input as FileReadInput).path)), 'utf8'); return { ok: true, message: 'file read', output: file.slice(0, Number(input.maxBytes ?? file.length)) } }
    if (toolName === 'file_write') { const typed = input as FileWriteInput; const target = workspacePath(this.context.workspaceRoot, typed.path); const before = await snapshot(target); await mkdir(dirname(target), { recursive: true }); await writeFile(target, typed.content, 'utf8'); const after = await snapshot(target); return { ok: true, message: 'file written', fileChanges: [{ path: typed.path, before, after }] } }
    if (toolName === 'apply_patch') { const typed = input as ApplyPatchInput; const target = workspacePath(this.context.workspaceRoot, typed.path); const before = await snapshot(target); const current = before.exists ? await readFile(target, 'utf8') : ''; const search = typed.oldText ?? typed.search ?? ''; const replace = typed.newText ?? typed.replace ?? ''; const next = search ? current.replace(String(search), String(replace)) : String(replace); await mkdir(dirname(target), { recursive: true }); await writeFile(target, next, 'utf8'); const after = await snapshot(target); return { ok: true, message: 'patch applied', fileChanges: [{ path: typed.path, before, after }] } }
    if (toolName === 'shell') { const typed = input as ShellInput; const shell = await runShellWithTimeout(typed.command, typed.args ?? [], resolve(this.context.workspaceRoot, typed.cwd ?? '.'), typed.timeoutMs ?? 5000); return { ok: shell.exitCode === 0 && !shell.timedOut, message: shell.timedOut ? 'shell timed out' : 'shell completed', shell } }
    if (toolName === 'gui_action') { if (!this.context.guiRuntime) throw new ToolRuntimeError('gui_runtime_missing', 'GuiRuntime is required for gui_action'); const gui = await this.context.guiRuntime.act((input as GuiToolInput).action); return { ok: gui.state === 'completed' || gui.state === 'verified', message: 'gui delegated to GuiRuntime', gui } }
    throw new ToolRuntimeError('unsupported_tool', 'Unsupported tool: ' + toolName)
  }

  private async emit(eventType: string, identity: Record<string, unknown>, eventIds: string[]): Promise<void> { if (!this.context.durable) return; const event = await this.context.durable.appendEvent({ eventType, workspaceId: this.context.workspaceId ?? 'default', runId: this.context.runId, loopId: this.context.loopId, goalId: this.context.goalId, payload: identity }); eventIds.push(event.eventId) }
}

function workspacePath(root: string, input: string): string { const target = resolve(root, input); const rel = target.toLowerCase().startsWith(resolve(root).toLowerCase()) ? target : resolve(root, input.replace(/^([a-zA-Z]:)?[\\/]+/, '')); return rel }
async function snapshot(path: string): Promise<FileHashSnapshot> { try { const info = await stat(path); const text = await readFile(path, 'utf8'); return { path, exists: true, sha256: simpleHash(text), bytes: info.size } } catch { return { path, exists: false } } }

