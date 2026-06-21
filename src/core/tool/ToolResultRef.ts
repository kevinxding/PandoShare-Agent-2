import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { ToolResultRef } from './ToolTypes.js'
let refCounter = 0
export async function storeToolResultRef(root: string, toolCallId: string, value: unknown): Promise<ToolResultRef> { refCounter += 1; const text = JSON.stringify(value, null, 2); const relativePath = '.pandoshare/tool-results/' + toolCallId + '-' + refCounter + '.json'; const absolutePath = resolve(root, relativePath); await mkdir(dirname(absolutePath), { recursive: true }); await writeFile(absolutePath, text, 'utf8'); return { refId: 'toolref_' + Date.now().toString(36) + '_' + refCounter, relativePath, absolutePath, sha256: simpleHash(text), bytes: text.length, preview: text.slice(0, 500) } }
export async function readToolResultRef(ref: ToolResultRef): Promise<string> { return readFile(ref.absolutePath, 'utf8') }
export function simpleHash(text: string): string { let hash = 2166136261; for (let i = 0; i < text.length; i += 1) hash = (hash ^ text.charCodeAt(i)) * 16777619; return Math.abs(hash).toString(16) }
export function workspaceRelative(root: string, target: string): string { return relative(resolve(root), resolve(target)).replace(/\\/g, '/') }
