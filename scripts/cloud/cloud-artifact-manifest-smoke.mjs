#!/usr/bin/env node
const core = await import('../../dist/src/core/index.js')
const manifest = core.createArtifactSyncManifest([{ artifactId: 'a1', path: 'docs/kernel/generated-acceptance-report.md' }])
assert(manifest.redacted === true, 'artifact manifest should be redacted')
assert(core.artifactManifestHasSecret(manifest) === false, 'artifact manifest should not contain secrets')
console.log('cloud artifact manifest smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
