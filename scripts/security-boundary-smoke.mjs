#!/usr/bin/env node
const core = await import('../dist/src/core/index.js')
const boundaries = core.permissionThreatBoundaries()
assert(boundaries.length >= 5, 'permission boundary smoke requires at least five boundaries')
const joined = boundaries.join('\n')
for (const word of ['read-only', 'workspace-write', 'GUI', 'gateway', 'replay']) assert(joined.includes(word), 'missing boundary ' + word)
console.log('security boundary smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
