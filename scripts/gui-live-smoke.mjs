#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const { closeMcpConnections, connectConfiguredMcpServers } = await import('../dist/src/services/mcp/index.js')
const { createGuiBackendFromMcpConnections } = await import('../dist/src/services/gui/index.js')
const { runTools } = await import('../dist/src/services/tools/toolOrchestration.js')
const { createToolRegistry } = await import('../dist/src/tools.js')
const { GuiTool } = await import('../dist/src/tools/GuiTool/index.js')

if (process.env.PANDO_GUI_LIVE_SMOKE !== '1') {
  console.log('gui live smoke skipped; set PANDO_GUI_LIVE_SMOKE=1 to run controlled desktop input validation')
  process.exit(0)
}

const configPath = resolve(process.cwd(), 'pandoshare.config.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const serverConfig = config.mcpServers?.dingxu_gui
assert(serverConfig, 'pandoshare.config.json must define mcpServers.dingxu_gui')

const tempDir = await mkdtemp(join(tmpdir(), 'pando-gui-live-'))
const readyPath = join(tempDir, 'ready.json')
const statePath = join(tempDir, 'state.json')
const stopPath = join(tempDir, 'stop')
const appPath = join(tempDir, 'gui-live-window.ps1')
await writeFile(appPath, testWindowScript(), 'utf8')

let app
let connections = []
try {
  app = launchTestWindow(appPath, readyPath, statePath, stopPath)
  const ready = await waitForJson(readyPath, () => app.exited, 'test window readiness')
  assert(ready.title === 'Pando GUI Live Smoke', `unexpected test window title: ${ready.title}`)

  connections = await connectConfiguredMcpServers({
    mcpServers: {
      dingxu_gui: serverConfig,
    },
  })
  const backend = createGuiBackendFromMcpConnections(connections)
  assert(backend, 'dingxu_gui connection should create a GUI backend')

  const registry = createToolRegistry([GuiTool])
  const events = []
  const context = {
    cwd: process.cwd(),
    sessionId: 'gui-live-smoke',
    permissionMode: 'default',
    permissions: {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    },
    metadata: {
      guiBackend: backend,
    },
    emitEvent(event) {
      events.push(event)
    },
  }

  await expectOk(await runGui(registry, context, 'live_release_before', {
    action: 'release_all',
    timeoutMs: 1,
  }), 'initial release_all')

  await expectOk(await runGui(registry, context, 'live_click_button', {
    action: 'click',
    x: ready.button.x,
    y: ready.button.y,
    verify: 'optional',
    timeoutMs: 150,
  }), 'button click')
  await waitForState(statePath, state => state.clicked === true, 'button click state')

  await expectOk(await runGui(registry, context, 'live_type_initial', {
    action: 'type',
    x: ready.textbox.x,
    y: ready.textbox.y,
    text: 'PANDO_GUI_LIVE_OK',
    forceUnicode: true,
    verify: 'optional',
    timeoutMs: 100,
  }), 'coordinate typing')
  await waitForState(statePath, state => state.text === 'PANDO_GUI_LIVE_OK', 'initial typed text')

  await expectOk(await runGui(registry, context, 'live_ctrl_a', {
    action: 'hotkey',
    x: ready.textbox.x,
    y: ready.textbox.y,
    keys: ['Ctrl', 'A'],
    verify: 'optional',
    timeoutMs: 100,
  }), 'Ctrl+A hotkey')

  await expectOk(await runGui(registry, context, 'live_type_replacement', {
    action: 'type',
    text: 'PANDO_GUI_REPLACED',
    forceUnicode: true,
    verify: 'optional',
    timeoutMs: 100,
  }), 'focused replacement typing')
  await waitForState(statePath, state => state.text === 'PANDO_GUI_REPLACED', 'replacement typed text')

  await expectOk(await runGui(registry, context, 'live_release_after', {
    action: 'release_all',
    timeoutMs: 1,
  }), 'final release_all')

  assert(events.some(event => event.type === 'gui_action_started'), 'events should include gui_action_started')
  assert(events.some(event => event.type === 'gui_action_completed'), 'events should include gui_action_completed')
  assert(events.every(event => event.type !== 'gui_action_failed'), 'live GUI smoke should not emit failed actions')

  console.log('gui live smoke passed')
} finally {
  closeMcpConnections(connections)
  await writeFile(stopPath, 'stop', 'utf8').catch(() => undefined)
  if (app) await waitForExit(app, 3000).catch(() => app.kill())
  await rm(tempDir, { recursive: true, force: true })
}

function launchTestWindow(appPath, readyPath, statePath, stopPath) {
  const powershell = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const child = spawn(powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    appPath,
    readyPath,
    statePath,
    stopPath,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })
  child.stdoutText = ''
  child.stderrText = ''
  child.exited = false
  child.stdout.on('data', chunk => {
    child.stdoutText += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    child.stderrText += chunk.toString()
  })
  child.on('exit', code => {
    child.exited = true
    child.exitCodeValue = code
  })
  return child
}

async function runGui(registry, context, id, input) {
  const results = []
  for await (const update of runTools([{ id, name: 'gui_action', input }], registry, context)) {
    results.push(update.result)
  }
  assert(results.length === 1, `expected one GUI result for ${id}`)
  return results[0]
}

async function expectOk(result, label) {
  const payload = parseToolResult(result)
  assert(result.ok, `${label} should pass: ${result.content}`)
  assert(payload.ok === true, `${label} payload should be ok: ${result.content}`)
  assert(payload.method === 'human_gui', `${label} should use human_gui: ${result.content}`)
  return payload
}

function parseToolResult(result) {
  try {
    return JSON.parse(result.content)
  } catch {
    throw new Error(`GUI result is not JSON: ${result.content}`)
  }
}

async function waitForJson(path, exited, label, timeoutMs = 10000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      return await readJson(path)
    } catch (error) {
      lastError = error
      if (exited()) break
      await sleep(100)
    }
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function waitForState(path, predicate, label, timeoutMs = 10000) {
  const started = Date.now()
  let lastState
  while (Date.now() - started < timeoutMs) {
    try {
      const state = await readJson(path)
      lastState = state
      if (predicate(state)) return state
    } catch {
      // The window writes this file asynchronously; retry until timeout.
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(lastState)}`)
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, ''))
}

async function waitForExit(child, timeoutMs) {
  if (child.exited) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error(`process did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    function onExit() {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function testWindowScript() {
  return String.raw`param(
  [Parameter(Mandatory = $true)][string]$ReadyPath,
  [Parameter(Mandatory = $true)][string]$StatePath,
  [Parameter(Mandatory = $true)][string]$StopPath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public static class PandoDpi {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@
[PandoDpi]::SetProcessDPIAware() | Out-Null

$script:utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:clicked = $false
$script:lastKey = ""

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Pando GUI Live Smoke"
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(120, 120)
$form.Size = New-Object System.Drawing.Size(640, 320)
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = "Pando GUI live smoke input"
$label.Location = New-Object System.Drawing.Point(24, 20)
$label.Size = New-Object System.Drawing.Size(360, 24)
$form.Controls.Add($label)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Name = "PandoGuiLiveInput"
$textBox.Location = New-Object System.Drawing.Point(24, 58)
$textBox.Size = New-Object System.Drawing.Size(560, 28)
$form.Controls.Add($textBox)

$button = New-Object System.Windows.Forms.Button
$button.Text = "Click Target"
$button.Location = New-Object System.Drawing.Point(24, 104)
$button.Size = New-Object System.Drawing.Size(130, 34)
$form.Controls.Add($button)

$status = New-Object System.Windows.Forms.Label
$status.Text = "ready"
$status.Location = New-Object System.Drawing.Point(24, 154)
$status.Size = New-Object System.Drawing.Size(560, 24)
$form.Controls.Add($status)

$script:textBox = $textBox
$script:button = $button
$script:status = $status

function Write-JsonFile {
  param([string]$Path, [object]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($Path, $json, $script:utf8NoBom)
}

function UnixNowMs {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Write-State {
  Write-JsonFile $StatePath ([ordered]@{
    title = $form.Text
    text = $script:textBox.Text
    clicked = $script:clicked
    lastKey = $script:lastKey
    textboxFocused = $script:textBox.Focused
    updatedAtMs = UnixNowMs
  })
}

function Write-Ready {
  $textboxPoint = $script:textBox.PointToScreen((New-Object System.Drawing.Point(20, ([int]($script:textBox.Height / 2)))))
  $buttonPoint = $script:button.PointToScreen((New-Object System.Drawing.Point(([int]($script:button.Width / 2)), ([int]($script:button.Height / 2)))))
  Write-JsonFile $ReadyPath ([ordered]@{
    title = $form.Text
    textbox = [ordered]@{
      x = $textboxPoint.X
      y = $textboxPoint.Y
    }
    button = [ordered]@{
      x = $buttonPoint.X
      y = $buttonPoint.Y
    }
    readyAtMs = UnixNowMs
  })
}

$textBox.Add_TextChanged({
  Write-State
})

$textBox.Add_KeyDown({
  param($sender, $eventArgs)
  $parts = New-Object System.Collections.Generic.List[string]
  if ($eventArgs.Control) { $parts.Add("Ctrl") }
  if ($eventArgs.Alt) { $parts.Add("Alt") }
  if ($eventArgs.Shift) { $parts.Add("Shift") }
  $parts.Add($eventArgs.KeyCode.ToString())
  $script:lastKey = [string]::Join("+", $parts)
  Write-State
})

$button.Add_Click({
  $script:clicked = $true
  $script:status.Text = "clicked"
  Write-State
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
  if (Test-Path -LiteralPath $StopPath) {
    $timer.Stop()
    $form.Close()
  }
})
$timer.Start()

$form.Add_Shown({
  $form.Activate()
  $script:textBox.Focus()
  Write-State
  Write-Ready
})

[System.Windows.Forms.Application]::Run($form)
`
}
