import type { ToolMetadata, ToolName } from './ToolTypes.js'
export class ToolRegistryV2 {
  private readonly tools = new Map<string, ToolMetadata>()
  constructor(seed: readonly ToolMetadata[] = defaultToolMetadata()) { for (const item of seed) this.tools.set(item.name, item) }
  get(toolName: string): ToolMetadata | undefined { return this.tools.get(toolName) }
  list(): ToolMetadata[] { return [...this.tools.values()] }
}
export function defaultToolMetadata(): ToolMetadata[] { return [
  { name: 'file_read', description: 'Read a workspace file', category: 'file', risk: 'read_only', offline: true },
  { name: 'file_write', description: 'Write a workspace file', category: 'file', risk: 'write', offline: true, writesFiles: true },
  { name: 'apply_patch', description: 'Apply a simple text patch', category: 'file', risk: 'write', offline: true, writesFiles: true },
  { name: 'shell', description: 'Run a shell command', category: 'process', risk: 'dangerous_write', offline: true },
  { name: 'gui_action', description: 'Delegate to GuiRuntime', category: 'gui', risk: 'write', offline: true, delegatesTo: 'GuiRuntime' },
] }
export type { ToolName }
