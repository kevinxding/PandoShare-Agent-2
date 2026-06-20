export type AgentContext = {
  cwd: string
  sessionId: string
}

export function createAgentContext(cwd: string, sessionId: string): AgentContext {
  return { cwd, sessionId }
}

