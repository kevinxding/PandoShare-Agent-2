import { BackendUnsupportedActionError } from './errors.js'
import type { BackendExecution, BackendHandlerMap, BackendHandlerResult, NormalizedBackendRequest } from './types.js'

export class BackendRouter {
  constructor(private readonly handlers: BackendHandlerMap) {}

  async route(request: NormalizedBackendRequest, execution: BackendExecution): Promise<BackendHandlerResult> {
    const handler = this.handlers[request.action]
    if (!handler) throw new BackendUnsupportedActionError(request.action)
    return handler(request, execution)
  }
}
