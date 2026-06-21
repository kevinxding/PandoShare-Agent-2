export class ToolRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: unknown) { super(message); this.name = 'ToolRuntimeError' }
}
