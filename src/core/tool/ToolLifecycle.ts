export type ToolLifecycleStage = 'validate' | 'classify' | 'approval' | 'execute' | 'store_result' | 'verify' | 'event' | 'checkpoint'
export const TOOL_LIFECYCLE: ToolLifecycleStage[] = ['validate', 'classify', 'approval', 'execute', 'store_result', 'verify', 'event', 'checkpoint']
