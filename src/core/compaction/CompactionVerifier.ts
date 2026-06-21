export type ToolTranscriptMessage = { role: string; toolCallId?: string; toolCalls?: Array<{ id?: string }> }

export class CompactionVerifier {
  verifyToolPairing(messages: readonly ToolTranscriptMessage[]): { ok: boolean; errors: string[] } {
    const open = new Set<string>()
    for (const message of messages) {
      for (const call of message.toolCalls ?? []) if (call.id) open.add(call.id)
      if (message.role === 'tool' && message.toolCallId) open.delete(message.toolCallId)
    }
    return { ok: open.size === 0, errors: [...open].map(id => 'missing tool result for ' + id) }
  }
}
