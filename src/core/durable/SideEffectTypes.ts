export type SideEffectType =
  | 'readonly_tool'
  | 'file_read'
  | 'file_write'
  | 'shell_readonly'
  | 'shell_write'
  | 'gui_read'
  | 'gui_write'
  | 'gateway_inbound'
  | 'gateway_outbound'
  | 'model_request'
  | 'mcp_read'
  | 'mcp_write'
  | 'unknown_external'

export type SideEffectHint = {
  effectId?: string
  effectType?: SideEffectType
  source?: 'tool' | 'shell' | 'gui' | 'gateway' | 'model' | 'mcp' | 'file' | 'unknown'
  action?: string
  command?: string
  toolName?: string
  summary?: string
  confirmed?: boolean
}

export type ClassifiedSideEffect = {
  effectId: string
  effectType: SideEffectType
  autoRecoverable: boolean
  requiresHuman: boolean
  summary: string
  confirmed: boolean
}
