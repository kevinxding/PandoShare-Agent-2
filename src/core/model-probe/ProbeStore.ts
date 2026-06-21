import { resolve } from 'node:path'
import { JsonlStore } from '../store/JsonlStore.js'
import type { ModelProbeRun } from './ModelProbeTypes.js'
import { redactProbeValue } from './ProbeReport.js'

export type ProbeStoreOptions = {
  path?: string
  outputDir?: string
  workspaceRoot?: string
}

export class ProbeStore {
  readonly jsonlPath: string

  constructor(options: ProbeStoreOptions = {}) {
    const outputDir = options.outputDir ?? resolve(options.workspaceRoot ?? '.', '.pandoshare', 'model-probes')
    this.jsonlPath = options.path ?? resolve(outputDir, 'model-probe-runs.jsonl')
  }

  async append(run: ModelProbeRun): Promise<void> {
    await new JsonlStore<ModelProbeRun>(this.jsonlPath).append(redactProbeValue(run))
  }

  async read(): Promise<ModelProbeRun[]> {
    return (await new JsonlStore<ModelProbeRun>(this.jsonlPath).read()).records
  }
}
