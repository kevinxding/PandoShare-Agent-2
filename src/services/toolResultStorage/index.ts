import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import type { ToolResult, ToolResultStorageOptions, ToolUseContext } from '../../Tool.js'

export type StoredToolResultMetadata = {
  stored: true
  storageId: string
  relativePath: string
  originalChars: number
  previewChars: number
  inlineCharLimit: number
}

export const DEFAULT_TOOL_RESULT_INLINE_CHAR_LIMIT = 50_000
export const DEFAULT_TOOL_RESULT_PREVIEW_CHARS = 2_000

const TOOL_RESULTS_DIR = 'tool-results'

export async function maybeStoreLargeToolResult(
  result: ToolResult,
  context: ToolUseContext,
  toolName: string,
): Promise<ToolResult> {
  const options = normalizeOptions(context.toolResultStorage)
  if (!options.enabled) return result
  if (!context.threadId) return result
  if (result.content.length <= options.inlineCharLimit) return result

  const workspaceRoot = resolve(context.cwd)
  const threadId = sanitizePathSegment(context.threadId)
  const storageId = `${sanitizePathSegment(result.toolUseId)}_${Date.now()}_${shortId()}.txt`
  const relativePath = `.pandoshare/threads/${threadId}/${TOOL_RESULTS_DIR}/${storageId}`
  const absolutePath = resolve(workspaceRoot, relativePath)
  assertInsideWorkspace(workspaceRoot, absolutePath)

  await mkdir(resolve(workspaceRoot, `.pandoshare/threads/${threadId}/${TOOL_RESULTS_DIR}`), { recursive: true })
  await writeFile(absolutePath, result.content, 'utf8')

  const preview = previewText(result.content, options.previewChars)
  const metadata: StoredToolResultMetadata = {
    stored: true,
    storageId,
    relativePath,
    originalChars: result.content.length,
    previewChars: preview.length,
    inlineCharLimit: options.inlineCharLimit,
  }

  return {
    ...result,
    content: buildStoredResultMessage({
      toolName,
      relativePath,
      originalChars: result.content.length,
      preview,
    }),
    metadata: {
      ...(result.metadata ?? {}),
      toolResultStorage: metadata,
    },
  }
}

function normalizeOptions(options: ToolResultStorageOptions | undefined): Required<ToolResultStorageOptions> {
  return {
    enabled: options?.enabled ?? true,
    inlineCharLimit: options?.inlineCharLimit ?? readPositiveIntegerEnv('PANDOSHARE_TOOL_RESULT_INLINE_CHAR_LIMIT', DEFAULT_TOOL_RESULT_INLINE_CHAR_LIMIT),
    previewChars: options?.previewChars ?? readPositiveIntegerEnv('PANDOSHARE_TOOL_RESULT_PREVIEW_CHARS', DEFAULT_TOOL_RESULT_PREVIEW_CHARS),
  }
}

function buildStoredResultMessage(input: {
  toolName: string
  relativePath: string
  originalChars: number
  preview: string
}): string {
  return [
    '[persisted tool result]',
    `tool: ${input.toolName}`,
    `originalChars: ${input.originalChars}`,
    `fullOutputPath: ${input.relativePath}`,
    'The full output was stored on disk. Read the path above if the complete output is needed.',
    '',
    `Preview (first ${input.preview.length} chars):`,
    input.preview,
    '[/persisted tool result]',
  ].join('\n')
}

function previewText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return sanitized || 'item'
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  const relativePath = relative(workspaceRoot, targetPath)
  if (relativePath === '') return
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Tool result path is outside workspace: ${targetPath}`)
  }
}

function readPositiveIntegerEnv(key: string, fallback: number): number {
  const runtime = globalThis as unknown as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }
  const raw = runtime.process?.env?.[key]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}
