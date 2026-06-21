import { ContextBuilderV2 } from './ContextBuilderV2.js'
import type { ContextPack, ContextRuntimeInput } from './ContextTypes.js'

export class ContextRuntime {
  constructor(private readonly builder = new ContextBuilderV2()) {}

  buildContext(input: ContextRuntimeInput): ContextPack {
    return this.builder.build(input)
  }

  auditContext(input: ContextRuntimeInput): ContextPack['audit'] {
    return this.buildContext(input).audit
  }
}
