import { createArtifactSyncManifest } from './ArtifactSyncManifest.js'
import type { CloudPermissionProfile, CloudTaskType, RemoteJobEnvelope } from './CloudTypes.js'
export function createRemoteJobEnvelope(input: { workspaceId: string; source?: string; taskType: CloudTaskType; payload?: Record<string, unknown>; requiredCapabilities?: string[]; permissionProfile?: CloudPermissionProfile; ttlMs?: number; nowMs?: number; idempotencyKey?: string }): RemoteJobEnvelope {
  const nowMs = input.nowMs ?? Date.now()
  return { jobId: 'cloud_job_' + nowMs.toString(36), workspaceId: input.workspaceId, source: input.source ?? 'local', taskType: input.taskType, payload: input.payload ?? {}, requiredCapabilities: input.requiredCapabilities ?? [], permissionProfile: input.permissionProfile ?? 'approval-required', artifactManifest: createArtifactSyncManifest(), createdAtMs: nowMs, expiresAtMs: nowMs + (input.ttlMs ?? 60000), idempotencyKey: input.idempotencyKey ?? 'idem_' + nowMs.toString(36) }
}
