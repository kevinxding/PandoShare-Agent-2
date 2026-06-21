import type { ArtifactSyncManifest } from './CloudTypes.js'
export function createArtifactSyncManifest(refs: ArtifactSyncManifest['refs'] = []): ArtifactSyncManifest {
  const safeRefs = refs.map(ref => ({ artifactId: ref.artifactId, path: ref.path, sha256: ref.sha256, sizeBytes: ref.sizeBytes }))
  return { refs: safeRefs, redacted: true }
}
export function artifactManifestHasSecret(manifest: ArtifactSyncManifest): boolean {
  return /token|secret|api[-_]?key|authorization|password/i.test(JSON.stringify(manifest))
}
