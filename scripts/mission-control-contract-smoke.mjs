#!/usr/bin/env node
const core = await import('../dist/src/core/index.js')
const service = new core.MissionControlService({ workspaceRoot: process.cwd(), now: () => 1000 })
const overview = service.getOverview()
assert(overview.ok === true, 'overview response must be ok')
for (const key of ['workspace','agent','durable','loop','gui','gateway','model','replay','health','approvals','cost','recentIncidents','recentEvents']) assert(key in overview.data, 'overview missing ' + key)
const active = service.getActiveWork()
for (const key of ['activeRuns','activeLoops','pendingApprovals','activeGuiActions','gatewayQueue','modelRateLimits','staleHeartbeats','recoveryRequired']) assert(Array.isArray(active.data[key]), 'active missing array ' + key)
const text = JSON.stringify(overview) + JSON.stringify(active)
assert(!/sk-[A-Za-z0-9_-]{12,}|authorization|apiKey/i.test(text), 'mission contract leaked secret-like text')
console.log('mission control contract smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
