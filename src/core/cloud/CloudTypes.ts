export type CloudWorkerKind = 'local' | 'mock' | 'remote_placeholder'
export type CloudTaskType = 'agent' | 'loop' | 'gui' | 'replay' | 'benchmark'
export type CloudPermissionProfile = 'read-only' | 'workspace-write' | 'approval-required'
export type ArtifactSyncManifest = { refs: Array<{ artifactId: string; path?: string; sha256?: string; sizeBytes?: number }>; redacted: boolean }
export type RemoteJobEnvelope = { jobId: string; workspaceId: string; source: string; taskType: CloudTaskType; payload: Record<string, unknown>; requiredCapabilities: string[]; permissionProfile: CloudPermissionProfile; artifactManifest: ArtifactSyncManifest; createdAtMs: number; expiresAtMs: number; idempotencyKey: string }
export type WorkerRecord = { workerId: string; kind: CloudWorkerKind; capabilities: string[]; status: 'idle' | 'leased' | 'offline' | 'disabled'; lastHeartbeatAtMs: number; activeJobId?: string; endpointRef?: string; metadata?: Record<string, unknown> }
export type WorkerLease = { leaseId: string; workerId: string; jobId: string; leasedAtMs: number; expiresAtMs: number }
export type CloudJobRecord = { envelope: RemoteJobEnvelope; status: 'queued' | 'leased' | 'completed' | 'failed'; lease?: WorkerLease; completedAtMs?: number; failedAtMs?: number; message?: string }
