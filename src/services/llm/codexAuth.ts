import { readEnv } from './auth.js'
import type { AuthConfig } from './types.js'

export const CODEX_ACCESS_TOKEN_ENV_KEYS = ['CODEX_ACCESS_TOKEN'] as const
export const CODEX_ACCOUNT_ID_ENV_KEYS = ['CODEX_CHATGPT_ACCOUNT_ID', 'CHATGPT_ACCOUNT_ID'] as const

export type CodexAccessTokenAuthInput = {
  tokenEnvKeys?: readonly string[]
  accountIdEnvKeys?: readonly string[]
}

export type CodexAuthStatus = {
  accessTokenConfigured: boolean
  accessTokenSource?: string
  accountIdConfigured: boolean
  accountIdSource?: string
}

export function createCodexAccessTokenAuth(input: CodexAccessTokenAuthInput = {}): AuthConfig {
  return {
    type: 'codex-access-token',
    envKeys: input.tokenEnvKeys ?? CODEX_ACCESS_TOKEN_ENV_KEYS,
    accountIdEnvKeys: input.accountIdEnvKeys ?? CODEX_ACCOUNT_ID_ENV_KEYS,
  }
}

export function getCodexAuthStatus(input: CodexAccessTokenAuthInput = {}): CodexAuthStatus {
  const token = readEnv(input.tokenEnvKeys ?? CODEX_ACCESS_TOKEN_ENV_KEYS)
  const accountId = readEnv(input.accountIdEnvKeys ?? CODEX_ACCOUNT_ID_ENV_KEYS)
  return {
    accessTokenConfigured: Boolean(token.value),
    accessTokenSource: token.key,
    accountIdConfigured: Boolean(accountId.value),
    accountIdSource: accountId.key,
  }
}
