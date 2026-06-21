#!/usr/bin/env node
const core = await import('../dist/src/core/index.js')
const report = await new core.LicenseAudit(process.cwd()).run()
assert(report.packageName === 'pandoshare-agent', 'license audit should read package name')
assert(report.dependencies.length >= 1, 'license audit should include dependencies')
assert(report.provenance.some(item => item.includes('Claude Code research')), 'provenance must include Claude clean-room boundary')
if (report.privatePackage) assert(report.blockers.some(item => item.includes('not publishable')), 'private package must report publish blocker')
console.log('security license smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
