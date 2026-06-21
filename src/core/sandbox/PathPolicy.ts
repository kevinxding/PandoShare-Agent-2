import { isAbsolute, normalize, relative, resolve } from 'node:path'
import { createPolicyResult, type PolicyResult, type SandboxMode } from './SandboxTypes.js'

export type PathOperation = 'read' | 'write' | 'delete' | 'move' | 'copy'

export type PathPolicyOptions = {
  sandboxMode?: SandboxMode
  workspaceRoot: string
  readableRoots?: readonly string[]
  writableRoots?: readonly string[]
  profileName?: string
}

export type PathCheckInput = {
  path: string
  operation: PathOperation
  targetPath?: string
}

export class PathPolicy {
  private readonly sandboxMode: SandboxMode
  private readonly workspaceRoot: string
  private readonly readableRoots: string[]
  private readonly writableRoots: string[]
  private readonly profileName?: string

  constructor(options: PathPolicyOptions) {
    this.sandboxMode = options.sandboxMode ?? 'workspace-write'
    this.workspaceRoot = normalizePolicyPath(options.workspaceRoot)
    this.readableRoots = (options.readableRoots ?? [options.workspaceRoot]).map(root => normalizePolicyPath(root, this.workspaceRoot))
    this.writableRoots = (options.writableRoots ?? [options.workspaceRoot]).map(root => normalizePolicyPath(root, this.workspaceRoot))
    this.profileName = options.profileName
  }

  checkPath(input: PathCheckInput): PolicyResult {
    const checkedPath = normalizePolicyPath(input.path, this.workspaceRoot)
    const targetPath = input.targetPath ? normalizePolicyPath(input.targetPath, this.workspaceRoot) : undefined
    const target = targetPath ? checkedPath + ' -> ' + targetPath : checkedPath

    if (input.operation === 'read') {
      if (this.sandboxMode === 'full-access' || this.isReadable(checkedPath)) {
        return createPolicyResult({ subject: 'path', decision: 'allow', reason: 'read path is inside an allowed read root', target, profileName: this.profileName, metadata: { operation: input.operation } })
      }
      return createPolicyResult({ subject: 'path', decision: 'ask', reason: 'read path is outside configured read roots', target, profileName: this.profileName, metadata: { operation: input.operation } })
    }

    if (isSamePath(checkedPath, this.workspaceRoot) && (input.operation === 'delete' || input.operation === 'move')) {
      return createPolicyResult({ subject: 'path', decision: 'deny', reason: 'operation targets the workspace root', target, profileName: this.profileName, metadata: { operation: input.operation } })
    }

    if (targetPath && !this.isWritable(targetPath)) {
      return createPolicyResult({ subject: 'path', decision: this.sandboxMode === 'full-access' ? 'ask' : 'deny', reason: 'move/copy target is outside writable roots', target, profileName: this.profileName, metadata: { operation: input.operation }, risks: ['outside_move_or_copy'] })
    }

    if (this.sandboxMode === 'read-only') {
      return createPolicyResult({ subject: 'path', decision: 'ask', reason: input.operation + ' requires approval in read-only sandbox', target, profileName: this.profileName, metadata: { operation: input.operation } })
    }

    if (this.sandboxMode === 'full-access' || this.isWritable(checkedPath)) {
      return createPolicyResult({ subject: 'path', decision: 'allow', reason: input.operation + ' path is inside writable roots', target, profileName: this.profileName, metadata: { operation: input.operation } })
    }

    return createPolicyResult({ subject: 'path', decision: 'ask', reason: input.operation + ' path is outside writable roots', target, profileName: this.profileName, metadata: { operation: input.operation } })
  }

  private isReadable(candidate: string): boolean {
    return this.readableRoots.some(root => isPathInside(candidate, root))
  }

  private isWritable(candidate: string): boolean {
    return this.writableRoots.some(root => isPathInside(candidate, root))
  }
}

export function normalizePolicyPath(input: string, basePath?: string): string {
  const raw = input.trim()
  const normalized = normalize(isAbsolute(raw) ? raw : resolve(basePath ?? '.', raw))
  return isWindowsPath(normalized) ? normalized.replace(/\//g, '\\') : normalized
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizePolicyPath(candidatePath, rootPath)
  const root = normalizePolicyPath(rootPath)
  const rel = relative(root, candidate)
  const comparable = isWindowsPath(candidate) || isWindowsPath(root) ? rel.toLowerCase() : rel
  return comparable === '' || (!!comparable && !comparable.startsWith('..') && !isAbsolute(comparable))
}

export function isSamePath(leftPath: string, rightPath: string): boolean {
  const left = normalizePolicyPath(leftPath, rightPath)
  const right = normalizePolicyPath(rightPath)
  return isWindowsPath(left) || isWindowsPath(right) ? left.toLowerCase() === right.toLowerCase() : left === right
}

export function isWindowsPath(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('\\\\') || input.includes('\\')
}
