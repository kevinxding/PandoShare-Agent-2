#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const dist = resolve(root, 'web/dist')
const indexPath = resolve(dist, 'index.html')
const appSourcePath = resolve(root, 'web/src/App.tsx')
const cssSourcePath = resolve(root, 'web/src/styles.css')
const index = await readFile(indexPath, 'utf8')
const appSource = await readFile(appSourcePath, 'utf8')
const cssSource = await readFile(cssSourcePath, 'utf8')
assert(index.includes('/assets/'), 'web/dist/index.html should reference built assets')

const assets = await readdir(resolve(dist, 'assets'))
assert(assets.some(name => name.endsWith('.js')), 'web build should include a JS asset')
assert(assets.some(name => name.endsWith('.css')), 'web build should include a CSS asset')
assert((await stat(indexPath)).size > 100, 'index.html should not be empty')

const jsAssets = assets.filter(name => name.endsWith('.js'))
const js = (await Promise.all(jsAssets.map(name => readFile(resolve(dist, 'assets', name), 'utf8')))).join('\n')
for (const marker of [
  'New session',
  'Ask Pando to do something',
  'Runtime status strip',
  'Pando details',
  'Goal Dashboard',
  'Create goal',
  'Continue',
  'Loop Engineering',
  'Create loop',
  'Available tools',
  'GUI automation',
  'Running tasks',
  'Waiting questions',
  'Gateway',
  'Start',
  'Recover',
  'Stop',
  'Pending approvals',
  'Recent inbound',
  'Recent outbound',
  'Acceptance Health',
  'Provider',
  'Save model',
  'Use for current thread',
]) {
  assert(js.includes(marker), `web build should include minimal UI marker: ${marker}`)
}

const cssAssets = assets.filter(name => name.endsWith('.css'))
const css = (await Promise.all(cssAssets.map(name => readFile(resolve(dist, 'assets', name), 'utf8')))).join('\n')
for (const marker of ['opencode-shell', 'timeline-viewport', 'composer-dock', 'right-panel', 'command-palette', 'file-list', 'context-strip']) {
  assert(css.includes(marker), `web build should include minimal shell marker: ${marker}`)
}

for (const marker of [
  'data-product-surface="runtime-status"',
  'data-product-surface="inspector-panel"',
  'data-product-surface="tools-runs-gui"',
  'data-product-surface="goal-dashboard"',
  'data-product-surface="loop-task-monitor"',
  'data-product-surface="gateway-dashboard"',
  'data-product-surface="model-provider-settings"',
  'aria-label="Runtime status strip"',
  'aria-label="Tools, runs, questions, and GUI automation panel"',
  'aria-label="Goal dashboard"',
  'aria-label="Loop and task monitor"',
  'aria-label="Gateway and heartbeat dashboard"',
  'aria-label="Model provider and runtime settings"',
]) {
  assert(appSource.includes(marker), `web source should expose minimal surface contract: ${marker}`)
}

for (const marker of [
  "getJson<ThreadSummary[]>('/api/threads')",
  "getJson<GoalSummary[]>('/api/goals')",
  "getJson<LoopSummary[]>('/api/loops')",
  "getJson<GatewayStatus>('/api/gateway')",
  "getJson<GuiReport>('/api/gui')",
  "getJson<McpReport[]>('/api/mcp')",
  "getJson<SettingsReport>('/api/settings')",
  "getJson<AcceptanceStatus>('/api/acceptance')",
  "'/api/chat'",
  "'/api/gateway/start'",
  "'/api/gateway/recover'",
  "'/api/gateway/stop'",
  "'/api/gateway/message'",
]) {
  assert(appSource.includes(marker), `web source should wire backend endpoint: ${marker}`)
}

for (const marker of [
  '<InspectorTabButton id="tools" label="Tools" />',
  '<InspectorTabButton id="goal" label="Goal" />',
  '<InspectorTabButton id="loops" label="Loop" />',
  '<InspectorTabButton id="gateway" label="Gate" />',
  '<InspectorTabButton id="acceptance" label="Health" />',
  '<InspectorTabButton id="settings" label="Settings" />',
]) {
  assert(appSource.includes(marker), `web source should expose inspector navigation contract: ${marker}`)
}

assertCssRule(cssSource, '.context-strip', ['flex-wrap: wrap', 'overflow: visible'])
assertCssRule(cssSource, '.context-strip .status-pill', ['min-width: 0', 'max-width: 220px'])
assert(cssSource.includes('@media (max-width: 760px)'), 'web CSS should include mobile layout breakpoint')
assertCssRule(cssSource, '@media (max-width: 760px) .opencode-shell', ['grid-template-areas:'])
assertCssRule(cssSource, '@media (max-width: 760px) .sidebar-shell', ['display: none'])
assertCssRule(cssSource, '@media (max-width: 760px) .session-titlebar', ['flex-wrap: wrap'])
assertCssRule(cssSource, '@media (max-width: 760px) .context-strip', ['display: grid', 'grid-template-columns: repeat(2, minmax(0, 1fr))'])

console.log('web build smoke passed')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertCssRule(cssText, selector, declarations) {
  let blocks
  if (selector.startsWith('@media')) {
    const [, mediaSelector] = selector.split(/\)\s+/, 2)
    const mediaStart = cssText.indexOf('@media (max-width: 760px)')
    assert(mediaStart >= 0, `web CSS should include mobile media block for ${selector}`)
    const mediaText = cssText.slice(mediaStart)
    blocks = findCssBlocks(mediaText, mediaSelector)
  } else {
    blocks = findCssBlocks(cssText, selector)
  }
  assert(blocks.length > 0, `web CSS should include rule for ${selector}`)
  const matchingBlock = blocks.find(block => declarations.every(declaration => block.includes(declaration)))
  assert(Boolean(matchingBlock), `web CSS rule ${selector} should include ${declarations.join(', ')}`)
}

function findCssBlocks(cssText, selector) {
  const blocks = []
  let searchFrom = 0
  while (searchFrom < cssText.length) {
    const index = cssText.indexOf(selector, searchFrom)
    if (index < 0) break
    const start = cssText.indexOf('{', index)
    if (start < 0) break
    const end = cssText.indexOf('}', start)
    if (end < 0) break
    blocks.push(cssText.slice(start + 1, end))
    searchFrom = end + 1
  }
  return blocks
}
