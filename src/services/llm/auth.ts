import type { AuthConfig, EnvHeaderConfig } from './types.js'

type RuntimeEnv = {
  process?: {
    env?: Record<string, string | undefined>
  }
}

export type ResolvedAuth = {
  headers: Record<string, string>
  redactedHeaders: Record<string, string>
  missingEnv?: readonly string[]
  source?: string
}

export function readEnv(names: readonly string[]): { value?: string; key?: string } {
  const env = (globalThis as unknown as RuntimeEnv).process?.env
  for (const name of names) {
    const value = env?.[name]?.trim()
    if (value) return { value, key: name }
  }
  return {}
}

export function resolveAuth(auth: AuthConfig, requireAuth = true): ResolvedAuth {
  if (auth.type === 'none') {
    return { headers: {}, redactedHeaders: {} }
  }

  const token = auth.token?.trim() || readEnv(auth.envKeys).value
  const tokenSource = auth.token?.trim() ? 'inline-token' : readEnv(auth.envKeys).key
  if (!token) {
    if (requireAuth) {
      throw new Error(`Missing auth token. Set one of: ${auth.envKeys.join(', ')}`)
    }
    return {
      headers: {},
      redactedHeaders: {},
      missingEnv: auth.envKeys,
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  if (auth.type === 'codex-access-token') {
    const accountId = auth.accountId?.trim() || readEnv(auth.accountIdEnvKeys ?? []).value
    if (accountId) {
      headers['ChatGPT-Account-ID'] = accountId
    }
  }

  return {
    headers,
    redactedHeaders: redactHeaders(headers),
    source: tokenSource,
  }
}

export function resolveEnvHeaders(configs: readonly EnvHeaderConfig[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const config of configs ?? []) {
    const { value } = readEnv(config.envKeys)
    if (value) headers[config.header] = value
  }
  return headers
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = isSensitiveHeader(key) ? redactValue(value) : value
  }
  return redacted
}

function isSensitiveHeader(key: string): boolean {
  return ['authorization', 'x-api-key', 'api-key'].includes(key.toLowerCase())
}

function redactValue(value: string): string {
  if (value.length <= 12) return '<redacted>'
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}
