export function missionControlEventId(prefix: string, nowMs = Date.now()): string {
  return prefix + '_' + Math.trunc(nowMs).toString(36)
}

export function compactEvents(events: readonly unknown[], limit = 20): Array<Record<string, unknown>> {
  return events.slice(-limit).map((event, index) => {
    if (event && typeof event === 'object' && !Array.isArray(event)) return redactObject(event as Record<string, unknown>)
    return { index, value: String(event) }
  })
}

export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isSecretKey(key)) output[key] = '[REDACTED]'
    else if (value && typeof value === 'object' && !Array.isArray(value)) output[key] = redactObject(value as Record<string, unknown>)
    else if (Array.isArray(value)) output[key] = value.map(item => item && typeof item === 'object' ? redactObject(item as Record<string, unknown>) : item)
    else if (typeof value === 'string' && looksSecret(value)) output[key] = redactText(value)
    else output[key] = value
  }
  return output
}

export function redactText(input: string): string {
  return input
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED]')
    .replace(/\b(token|apiKey|authorization|password|cookie|secret)=([^&\s]+)/gi, '$1=[REDACTED]')
}

function isSecretKey(key: string): boolean {
  return /token|api[-_]?key|authorization|password|cookie|secret|private[-_]?key/i.test(key)
}

function looksSecret(value: string): boolean {
  return /\bsk-[A-Za-z0-9_-]{12,}\b/.test(value) || /Bearer\s+[A-Za-z0-9._-]{12,}/i.test(value)
}
