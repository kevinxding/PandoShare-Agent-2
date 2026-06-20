import { generateText, LLMProviderError, streamText } from '../../services/llm/client.js'
import type { GenerateOptions, LLMRequest, LLMResponse, LLMStreamEvent } from '../../services/llm/types.js'
import type { ModelRouter } from './ModelRouter.js'
import type { ModelRouteRequestV2 } from './ModelTypes.js'

export class ModelExecutionBridge {
  constructor(private readonly router: ModelRouter) {}

  async generateText(routeRequest: ModelRouteRequestV2, request: Omit<LLMRequest, 'model'>, options: GenerateOptions = {}): Promise<LLMResponse> {
    const decision = await this.router.route(routeRequest)
    if (!decision.selected) throw new Error(`Model route rejected: ${decision.routeReason.map(reason => reason.message).join('; ')}`)
    await this.router.recordRequestStarted(decision)
    try {
      const response = await generateText({ ...request, model: { provider: decision.selected.provider, model: decision.selected.modelId } }, options)
      await this.router.recordResponseCompleted(decision, response.usage)
      return response
    } catch (error) {
      await this.router.recordRequestFailed(decision, error)
      if (error instanceof LLMProviderError) throw error
      throw error
    }
  }

  async *streamText(routeRequest: ModelRouteRequestV2, request: Omit<LLMRequest, 'model'>, options: GenerateOptions = {}): AsyncIterable<LLMStreamEvent> {
    const decision = await this.router.route(routeRequest)
    if (!decision.selected) throw new Error(`Model route rejected: ${decision.routeReason.map(reason => reason.message).join('; ')}`)
    await this.router.recordRequestStarted(decision)
    try {
      let completedUsage: unknown
      for await (const event of streamText({ ...request, model: { provider: decision.selected.provider, model: decision.selected.modelId } }, options)) {
        if (event.type === 'completed') completedUsage = event.usage
        yield event
      }
      await this.router.recordResponseCompleted(decision, completedUsage)
    } catch (error) {
      await this.router.recordRequestFailed(decision, error)
      throw error
    }
  }
}