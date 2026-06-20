import type { GuiAdapter, GuiRuntimeAction, GuiRuntimeContext, GuiVerification } from './GuiTypes.js'

export class GuiActionVerifier {
  constructor(private readonly adapter: GuiAdapter) {}

  verify(action: GuiRuntimeAction, context?: GuiRuntimeContext): Promise<GuiVerification> {
    return this.adapter.verify(action, context)
  }
}
