import { JsonlStore, ProcessFileLock } from '../store/index.js'
import { createGuiLeaseId } from './GuiIdentity.js'
import type { GuiLease } from './GuiTypes.js'

export class GuiLeaseManager {
  private readonly lock: ProcessFileLock

  constructor(private readonly store: JsonlStore<GuiLease>) {
    this.lock = new ProcessFileLock(store.path)
  }

  async acquire(input: {
    workspaceId: string
    guiActionId: string
    holder?: string
    ttlMs?: number
  }): Promise<GuiLease> {
    const now = Date.now()
    const lease: GuiLease = {
      leaseId: createGuiLeaseId(now),
      guiActionId: input.guiActionId,
      workspaceId: input.workspaceId,
      acquiredAtMs: now,
      expiresAtMs: now + (input.ttlMs ?? 30_000),
      holder: input.holder ?? 'gui-runtime',
      status: 'running',
    }
    await this.lock.withLock({ reason: 'gui lease acquire' }, async () => {
      const active = await this.activeLease(input.workspaceId)
      if (active) throw new Error(`GUI write lease is already held by ${active.guiActionId}`)
      await this.store.append(lease)
    })
    return lease
  }

  async release(lease: GuiLease | undefined): Promise<GuiLease | undefined> {
    if (!lease) return undefined
    const released = {
      ...lease,
      status: 'released' as const,
      expiresAtMs: Date.now(),
    }
    await this.store.appendLocked(released, this.lock, { reason: 'gui lease release' })
    return released
  }

  async activeLease(workspaceId: string): Promise<GuiLease | undefined> {
    const byId = new Map<string, GuiLease>()
    for (const lease of await this.store.readRecords()) {
      if (lease.workspaceId === workspaceId) byId.set(lease.leaseId, lease)
    }
    const now = Date.now()
    return [...byId.values()]
      .filter(lease => lease.status === 'running' && lease.expiresAtMs > now)
      .sort((left, right) => right.acquiredAtMs - left.acquiredAtMs)[0]
  }
}
