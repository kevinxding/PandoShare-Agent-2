import {
  builtinProviders,
  createCustomOpenAICompatibleProvider,
  createDeepSeekProvider,
  createMiniMaxChinaTokenPlanProvider,
  createOpenAIProvider,
} from '../llm/providers.js'
import type { AuthConfig, ModelRef, ProviderCapabilities, ProviderDefinition, WireProtocol } from '../llm/types.js'
import type { ApprovalPolicy, ApprovalsReviewer, PermissionConfig, SandboxMode } from '../../Tool.js'

export const DEFAULT_CONFIG_FILENAMES = ['pandoshare.config.json'] as const
export const DEFAULT_PROVIDER_ID = 'minimax-cn'

export type ProjectConfig = {
  model?: ModelSelectionConfig
  providers?: Record<string, ProviderConfig>
  permissions?: PermissionConfig
  tokenBudget?: TokenBudgetConfig
  mcpServers?: Record<string, McpServerConfig>
  gateway?: GatewayConfig
}

export type TokenBudgetConfig = {
  enabled?: boolean
  contextWindowTokens?: number
  reserveOutputTokens?: number
  charsPerToken?: number
  includeContextMessage?: boolean
  warningThresholdPercent?: number
}

export type McpServerConfig = {
  command: string
  args?: readonly string[]
  startupTimeoutSec?: number
  messageFormat?: 'content-length' | 'json-lines'
}

export type GatewayConfig = {
  enabled?: boolean
  heartbeatIntervalMs?: number
  progressHeartbeatIntervalMs?: number
  wakeHeartbeatIntervalMs?: number
  allowUsers?: readonly string[]
  pairingSecretEnv?: string
  channels?: Record<string, GatewayChannelConfig>
}

export type GatewayChannelConfig = {
  kind: 'local' | 'mock' | 'telegram' | 'feishu' | 'lark' | 'wecom'
  enabled?: boolean
  tokenEnv?: string
  chatIdEnv?: string
  webhookEnv?: string
  ingressSecretEnv?: string
  allowedUsers?: readonly string[]
}

export type ModelSelectionConfig = {
  provider?: string
  name?: string
  providerOptions?: Record<string, Record<string, unknown> | undefined>
}

export type ProviderConfig = {
  name?: string
  baseURL?: string
  model?: string
  protocol?: WireProtocol
  apiKeyEnv?: string | readonly string[]
  auth?: ProviderAuthConfig
  defaultHeaders?: Record<string, string>
  envHeaders?: Record<string, string | readonly string[]>
  defaultBody?: Record<string, unknown>
  optionKeys?: readonly string[]
  capabilities?: Partial<ProviderCapabilities>
}

export type ProviderAuthConfig =
  | {
      type: 'none'
    }
  | {
      type: 'api-key'
      envKeys?: string | readonly string[]
    }
  | {
      type: 'codex-access-token'
      envKeys?: string | readonly string[]
      accountIdEnvKeys?: string | readonly string[]
    }

export type ConfigLoadResult = {
  path: string
  config: ProjectConfig
}

export type ReadConfigFile = (path: string) => Promise<string | undefined>

export async function loadProjectConfig(
  cwd: string,
  readFile: ReadConfigFile,
  filenames: readonly string[] = DEFAULT_CONFIG_FILENAMES,
): Promise<ConfigLoadResult | undefined> {
  for (const filename of filenames) {
    const path = joinPath(cwd, filename)
    const text = await readFile(path)
    if (text === undefined) continue
    return {
      path,
      config: parseProjectConfig(text, path),
    }
  }
  return undefined
}

export function parseProjectConfig(text: string, source = 'project config'): ProjectConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }

  assertRecord(parsed, source)
  validateProjectConfig(parsed, source)
  return parsed as ProjectConfig
}

export function resolveDefaultModel(config: ProjectConfig = {}): ModelRef {
  const providerId = config.model?.provider ?? DEFAULT_PROVIDER_ID
  const providerConfig = config.providers?.[providerId]
  const provider = providerConfig
    ? createConfiguredProvider(providerId, providerConfig, config.model?.name)
    : createBuiltinProvider(providerId)

  return {
    provider,
    model: config.model?.name ?? providerConfig?.model,
  }
}

export function createConfiguredProvider(
  providerId: string,
  config: ProviderConfig,
  selectedModel?: string,
): ProviderDefinition {
  const builtin = maybeBuiltinProvider(providerId)
  if (!builtin && !config.baseURL) {
    throw new Error(`Provider "${providerId}" requires baseURL in project config`)
  }

  const base = builtin ?? createCustomOpenAICompatibleProvider({
    id: providerId,
    name: config.name,
    baseURL: required(config.baseURL, `Provider "${providerId}" requires baseURL`),
    model: config.model ?? selectedModel ?? 'custom-model',
    apiKeyEnv: config.apiKeyEnv,
    defaultBody: config.defaultBody,
    capabilities: config.capabilities,
  })

  const auth = resolveAuthConfig(providerId, config, base.auth)
  return {
    ...base,
    name: config.name ?? base.name,
    baseURL: config.baseURL ?? base.baseURL,
    wireProtocol: config.protocol ?? base.wireProtocol,
    defaultModel: config.model ?? selectedModel ?? base.defaultModel,
    auth,
    defaultHeaders: mergeStringRecords(base.defaultHeaders, config.defaultHeaders),
    envHeaders: config.envHeaders ? normalizeEnvHeaders(config.envHeaders) : base.envHeaders,
    defaultBody: mergeUnknownRecords(base.defaultBody, config.defaultBody),
    optionKeys: config.optionKeys ?? base.optionKeys,
    capabilities: {
      ...base.capabilities,
      ...config.capabilities,
    },
  }
}

export function redactProjectConfig(config: ProjectConfig): ProjectConfig {
  return redactValue(config) as ProjectConfig
}

function createBuiltinProvider(providerId: string): ProviderDefinition {
  const provider = maybeBuiltinProvider(providerId)
  if (!provider) {
    throw new Error(`Unknown model provider "${providerId}". Add it under providers in pandoshare.config.json.`)
  }
  return provider
}

function maybeBuiltinProvider(providerId: string): ProviderDefinition | undefined {
  switch (providerId) {
    case 'openai':
      return createOpenAIProvider('api-key')
    case 'openai-codex':
      return createOpenAIProvider('codex')
    case 'deepseek':
      return createDeepSeekProvider()
    case 'minimax-cn':
      return createMiniMaxChinaTokenPlanProvider()
    default:
      return undefined
  }
}

function resolveAuthConfig(providerId: string, config: ProviderConfig, fallback: AuthConfig): AuthConfig {
  if (!config.auth && !config.apiKeyEnv) return fallback
  if (!config.auth) {
    return {
      type: 'api-key',
      envKeys: normalizeStringList(config.apiKeyEnv, `providers.${providerId}.apiKeyEnv`),
    }
  }

  switch (config.auth.type) {
    case 'none':
      return { type: 'none' }
    case 'api-key':
      return {
        type: 'api-key',
        envKeys: normalizeStringList(config.auth.envKeys ?? config.apiKeyEnv, `providers.${providerId}.auth.envKeys`),
      }
    case 'codex-access-token':
      return {
        type: 'codex-access-token',
        envKeys: normalizeStringList(
          config.auth.envKeys ?? ['CODEX_ACCESS_TOKEN'],
          `providers.${providerId}.auth.envKeys`,
        ),
        accountIdEnvKeys: normalizeOptionalStringList(
          config.auth.accountIdEnvKeys,
          `providers.${providerId}.auth.accountIdEnvKeys`,
        ),
      }
  }
}

function validateProjectConfig(config: Record<string, unknown>, source: string): void {
  if (config.model !== undefined) {
    assertRecord(config.model, `${source}.model`)
    const model = config.model
    assertOptionalString(model.provider, `${source}.model.provider`)
    assertOptionalString(model.name, `${source}.model.name`)
    if (model.providerOptions !== undefined) assertRecord(model.providerOptions, `${source}.model.providerOptions`)
  }

  if (config.providers !== undefined) {
    assertRecord(config.providers, `${source}.providers`)
    for (const [id, provider] of Object.entries(config.providers)) {
      assertRecord(provider, `${source}.providers.${id}`)
      assertOptionalString(provider.name, `${source}.providers.${id}.name`)
      assertOptionalString(provider.baseURL, `${source}.providers.${id}.baseURL`)
      assertOptionalString(provider.model, `${source}.providers.${id}.model`)
      assertOptionalProtocol(provider.protocol, `${source}.providers.${id}.protocol`)
      assertOptionalStringOrStringList(provider.apiKeyEnv, `${source}.providers.${id}.apiKeyEnv`)
      if (provider.auth !== undefined) {
        assertRecord(provider.auth, `${source}.providers.${id}.auth`)
        const auth = provider.auth
        if (!['none', 'api-key', 'codex-access-token'].includes(String(auth.type))) {
          throw new Error(`${source}.providers.${id}.auth.type must be none, api-key, or codex-access-token`)
        }
      }
      if (provider.defaultHeaders !== undefined) assertStringRecord(provider.defaultHeaders, `${source}.providers.${id}.defaultHeaders`)
      if (provider.envHeaders !== undefined) assertRecord(provider.envHeaders, `${source}.providers.${id}.envHeaders`)
      if (provider.defaultBody !== undefined) assertRecord(provider.defaultBody, `${source}.providers.${id}.defaultBody`)
      if (provider.optionKeys !== undefined) assertStringList(provider.optionKeys, `${source}.providers.${id}.optionKeys`)
      if (provider.capabilities !== undefined) assertProviderCapabilities(provider.capabilities, `${source}.providers.${id}.capabilities`)
    }
  }

  if (config.permissions !== undefined) {
    assertRecord(config.permissions, `${source}.permissions`)
    const permissions = config.permissions
    assertOneOf(permissions.approvalPolicy, `${source}.permissions.approvalPolicy`, [
      'unless-trusted',
      'on-failure',
      'on-request',
      'granular',
      'never',
    ] satisfies ApprovalPolicy[])
    assertOneOf(permissions.sandboxMode, `${source}.permissions.sandboxMode`, [
      'read-only',
      'workspace-write',
      'danger-full-access',
    ] satisfies SandboxMode[])
    if (permissions.approvalsReviewer !== undefined) {
      assertOneOf(permissions.approvalsReviewer, `${source}.permissions.approvalsReviewer`, [
        'user',
        'auto_review',
      ] satisfies ApprovalsReviewer[])
    }
    if (permissions.granular !== undefined) assertRecord(permissions.granular, `${source}.permissions.granular`)
    if (permissions.trustedTools !== undefined) assertStringList(permissions.trustedTools, `${source}.permissions.trustedTools`)
  }

  if (config.tokenBudget !== undefined) {
    assertRecord(config.tokenBudget, `${source}.tokenBudget`)
    const tokenBudget = config.tokenBudget
    assertOptionalBoolean(tokenBudget.enabled, `${source}.tokenBudget.enabled`)
    assertOptionalPositiveInteger(tokenBudget.contextWindowTokens, `${source}.tokenBudget.contextWindowTokens`)
    assertOptionalPositiveInteger(tokenBudget.reserveOutputTokens, `${source}.tokenBudget.reserveOutputTokens`)
    assertOptionalPositiveInteger(tokenBudget.charsPerToken, `${source}.tokenBudget.charsPerToken`)
    assertOptionalBoolean(tokenBudget.includeContextMessage, `${source}.tokenBudget.includeContextMessage`)
    assertOptionalPositiveInteger(tokenBudget.warningThresholdPercent, `${source}.tokenBudget.warningThresholdPercent`)
  }

  if (config.mcpServers !== undefined) {
    assertRecord(config.mcpServers, `${source}.mcpServers`)
    for (const [id, server] of Object.entries(config.mcpServers)) {
      assertRecord(server, `${source}.mcpServers.${id}`)
      assertIdentifier(id, `${source}.mcpServers key`)
      assertRequiredString(server.command, `${source}.mcpServers.${id}.command`)
      if (server.args !== undefined) assertStringList(server.args, `${source}.mcpServers.${id}.args`)
      assertOptionalPositiveInteger(server.startupTimeoutSec, `${source}.mcpServers.${id}.startupTimeoutSec`)
      assertOptionalOneOf(server.messageFormat, `${source}.mcpServers.${id}.messageFormat`, [
        'content-length',
        'json-lines',
      ])
    }
  }

  if (config.gateway !== undefined) {
    assertRecord(config.gateway, `${source}.gateway`)
    const gateway = config.gateway
    assertOptionalBoolean(gateway.enabled, `${source}.gateway.enabled`)
    assertOptionalPositiveInteger(gateway.heartbeatIntervalMs, `${source}.gateway.heartbeatIntervalMs`)
    assertOptionalPositiveInteger(gateway.progressHeartbeatIntervalMs, `${source}.gateway.progressHeartbeatIntervalMs`)
    assertOptionalPositiveInteger(gateway.wakeHeartbeatIntervalMs, `${source}.gateway.wakeHeartbeatIntervalMs`)
    if (gateway.allowUsers !== undefined) assertStringList(gateway.allowUsers, `${source}.gateway.allowUsers`)
    assertOptionalString(gateway.pairingSecretEnv, `${source}.gateway.pairingSecretEnv`)
    if (gateway.channels !== undefined) {
      assertRecord(gateway.channels, `${source}.gateway.channels`)
      for (const [id, channel] of Object.entries(gateway.channels)) {
        assertIdentifier(id, `${source}.gateway.channels key`)
        assertRecord(channel, `${source}.gateway.channels.${id}`)
        assertOneOf(channel.kind, `${source}.gateway.channels.${id}.kind`, [
          'local',
          'mock',
          'telegram',
          'feishu',
          'lark',
          'wecom',
        ])
        assertOptionalBoolean(channel.enabled, `${source}.gateway.channels.${id}.enabled`)
        assertOptionalString(channel.tokenEnv, `${source}.gateway.channels.${id}.tokenEnv`)
        assertOptionalString(channel.chatIdEnv, `${source}.gateway.channels.${id}.chatIdEnv`)
        assertOptionalString(channel.webhookEnv, `${source}.gateway.channels.${id}.webhookEnv`)
        assertOptionalString(channel.ingressSecretEnv, `${source}.gateway.channels.${id}.ingressSecretEnv`)
        if (channel.allowedUsers !== undefined) assertStringList(channel.allowedUsers, `${source}.gateway.channels.${id}.allowedUsers`)
      }
    }
  }
}

function normalizeEnvHeaders(input: Record<string, string | readonly string[]>) {
  return Object.entries(input).map(([header, envKeys]) => ({
    header,
    envKeys: normalizeStringList(envKeys, `envHeaders.${header}`),
  }))
}

function normalizeOptionalStringList(input: unknown, name: string): readonly string[] | undefined {
  if (input === undefined) return undefined
  return normalizeStringList(input, name)
}

function normalizeStringList(input: unknown, name: string): readonly string[] {
  if (typeof input === 'string') return [input]
  if (Array.isArray(input) && input.every((item) => typeof item === 'string')) return input
  throw new Error(`${name} must be a string or string array`)
}

function mergeStringRecords(
  base: Record<string, string> | undefined,
  patch: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !patch) return undefined
  return { ...base, ...patch }
}

function mergeUnknownRecords(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !patch) return undefined
  return { ...base, ...patch }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
}

function assertStringRecord(value: unknown, name: string): asserts value is Record<string, string> {
  assertRecord(value, name)
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`${name}.${key} must be a string`)
  }
}

function assertOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${name} must be a string`)
  }
}

function assertRequiredString(value: unknown, name: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`)
  }
}

function assertIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must contain only ASCII letters, digits, underscores, or hyphens`)
  }
}

function assertOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`)
  }
}

function assertOptionalPositiveInteger(value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function assertStringList(value: unknown, name: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be a string array`)
  }
}

function assertOptionalStringOrStringList(value: unknown, name: string): void {
  if (value === undefined) return
  if (typeof value === 'string') return
  assertStringList(value, name)
}

function assertOptionalProtocol(value: unknown, name: string): void {
  if (value === undefined) return
  if (value !== 'openai-chat-completions' && value !== 'openai-responses') {
    throw new Error(`${name} must be openai-chat-completions or openai-responses`)
  }
}

function assertProviderCapabilities(value: unknown, name: string): asserts value is Partial<ProviderCapabilities> {
  assertRecord(value, name)
  assertOptionalBoolean(value.tools, `${name}.tools`)
  assertOptionalBoolean(value.vision, `${name}.vision`)
  assertOptionalBoolean(value.streaming, `${name}.streaming`)
  assertOptionalBoolean(value.reasoning, `${name}.reasoning`)
  assertOptionalPositiveInteger(value.contextWindowTokens, `${name}.contextWindowTokens`)
}

function assertOneOf<T extends string>(value: unknown, name: string, options: readonly T[]): asserts value is T {
  if (typeof value !== 'string' || !options.includes(value as T)) {
    throw new Error(`${name} must be one of: ${options.join(', ')}`)
  }
}

function assertOptionalOneOf<T extends string>(value: unknown, name: string, options: readonly T[]): void {
  if (value === undefined) return
  assertOneOf(value, name, options)
}

function joinPath(base: string, filename: string): string {
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${filename}`
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') return value
  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? '<redacted>' : redactValue(item)
  }
  return redacted
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.includes('apikey') || normalized.includes('api_key') || normalized.includes('token')
}

export { builtinProviders }
