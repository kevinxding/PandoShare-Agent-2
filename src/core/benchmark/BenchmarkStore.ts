import { JsonlStore } from '../store/JsonlStore.js'
import type { BenchmarkRunResult } from './BenchmarkTypes.js'

export class BenchmarkStore {
  private readonly store: JsonlStore<BenchmarkRunResult>

  constructor(readonly path: string) {
    this.store = new JsonlStore(path)
  }

  async appendRun(run: BenchmarkRunResult): Promise<void> {
    await this.store.append(run)
  }

  async readRuns(): Promise<BenchmarkRunResult[]> {
    return this.store.readRecords()
  }
}
