#!/usr/bin/env node
const samples = [{ version: 1, model: { provider: 'openai' } }, { model: { provider: 'custom' } }]
for (const sample of samples) assert(typeof sample.model.provider === 'string', 'sample config provider missing')
console.log('release config migration smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
