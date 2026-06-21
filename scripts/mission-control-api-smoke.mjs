#!/usr/bin/env node
const { startPandoServer } = await import('../dist/src/server/index.js')
const server = await startPandoServer({ cwd: process.cwd(), port: 0, host: '127.0.0.1' })
try {
  const overview = await getJson(server.url + '/api/mission-control/overview')
  assert(overview.ok === true, 'overview API must return ok')
  assert(overview.data.workspace && overview.data.health, 'overview API missing core shape')
  const active = await getJson(server.url + '/api/mission-control/active')
  assert(Array.isArray(active.data.activeRuns), 'active API missing activeRuns')
  const action = await postJson(server.url + '/api/mission-control/action', { action: 'system.health', payload: { authorization: 'Bearer secretsecretsecret' } })
  assert(action.ok === true, 'action API must return ok')
  assert(action.data.backendAction === 'system.health', 'action API must use BackendService mapping')
  assert(!JSON.stringify(action).includes('secretsecretsecret'), 'action API leaked secret payload')
  console.log('mission control api smoke passed')
} finally {
  await server.close()
}
async function getJson(url) { const res = await fetch(url); assert(res.ok, 'GET failed ' + url); return res.json() }
async function postJson(url, body) { const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert(res.ok, 'POST failed ' + url); return res.json() }
function assert(value, message) { if (!value) throw new Error(message) }
