import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CodeTaskVerifier } from './CodeTaskFixture.js'

export type PatchVerifierResult = {
  ok: boolean
  errors: string[]
  checkedFiles: string[]
}

export class PatchVerifier {
  async verify(workspaceRoot: string, verifier: CodeTaskVerifier): Promise<PatchVerifierResult> {
    const errors: string[] = []
    const checkedFiles: string[] = []
    for (const path of verifier.changedFiles ?? []) {
      checkedFiles.push(path)
      if (!(await exists(resolve(workspaceRoot, path)))) errors.push('expected changed file missing: ' + path)
    }
    for (const path of verifier.forbiddenPaths ?? []) {
      checkedFiles.push(path)
      if (await exists(resolve(workspaceRoot, path))) errors.push('forbidden path exists: ' + path)
    }
    for (const item of verifier.mustContain ?? []) {
      checkedFiles.push(item.path)
      const text = await readFile(resolve(workspaceRoot, item.path), 'utf8').catch(() => '')
      if (!text.includes(item.text)) errors.push('file does not contain expected text: ' + item.path)
    }
    return { ok: errors.length === 0, errors, checkedFiles }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
