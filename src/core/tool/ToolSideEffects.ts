import type { ToolClassification, ToolMetadata } from './ToolTypes.js'
export function classifyTool(metadata: ToolMetadata): ToolClassification { return { risk: metadata.risk, reason: metadata.risk === 'read_only' ? 'declared read-only' : 'declared side effect', approvalRequired: metadata.risk === 'write' || metadata.risk === 'dangerous_write', metadata } }
