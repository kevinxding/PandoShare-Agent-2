#!/usr/bin/env node
import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const mission = new core.MissionControlService({ workspaceRoot: root }).getOverview()
assert(mission.ok === true && mission.data.workspace && mission.data.gateway && mission.data.model, 'MissionControlService overview unavailable')
const security = await core.writeSecurityAcceptanceReport(root)
assert(security.secretScan.scannedFiles > 0, 'Security report was not generated')
const release = await runNpm(['run', 'release:version-check'])
assert(release.exitCode === 0, 'release version check failed inside final smoke')
const chaos = await new core.ChaosRunner({ workspaceRoot: root, durationMs: 1000, maxIterations: 6 }).run()
assert(chaos.iterations >= 6, 'Chaos smoke unavailable')
const coordinator = new core.CloudCoordinator({ workspaceRoot: resolve(root, '.tmp-productization-final-cloud'), now: () => 500 })
coordinator.registerWorker({ workerId: 'final-mock', kind: 'mock', capabilities: ['agent'], status: 'idle', lastHeartbeatAtMs: 500 })
const job = await coordinator.submitJob(core.createRemoteJobEnvelope({ workspaceId: 'default', taskType: 'agent', requiredCapabilities: ['agent'], nowMs: 500 }))
const lease = await coordinator.leaseJob('final-mock')
assert(lease && lease.jobId === job.envelope.jobId, 'Cloud coordinator mock job lease failed')
const done = await coordinator.completeJob(job.envelope.jobId)
assert(done.status === 'completed', 'Cloud coordinator mock job did not complete')
const roadmap = await readText(resolve(root, 'docs/kernel/productization-roadmap.md'))
for (const phrase of ['12. Mission Control backend APIs','13. Security/License','14. CI/Release','15. 72h Chaos','16. Cloud worker foundation']) assert(roadmap.includes(phrase), 'roadmap missing ' + phrase)
await stat(resolve(root, 'docs/kernel/generated-acceptance-report.md'))
console.log('productization final smoke passed')
function runNpm(args) { return process.platform === 'win32' ? run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args]) : run('npm', args) }
function run(command, args) { return new Promise(resolveRun => { const child = spawn(command, args, { cwd: root, windowsHide: true }); let stdout=''; let stderr=''; child.stdout.on('data', c => stdout += String(c)); child.stderr.on('data', c => stderr += String(c)); child.on('close', code => resolveRun({ exitCode: code, stdout, stderr })); child.on('error', error => resolveRun({ exitCode: 1, stdout, stderr: String(error) })); }) }
async function readText(file) { const fs = await import('node:fs/promises'); return fs.readFile(file, 'utf8') }
function assert(value, message) { if (!value) throw new Error(message) }
