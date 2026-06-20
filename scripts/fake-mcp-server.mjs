#!/usr/bin/env node

if (process.argv.includes('--fail')) {
  process.exit(2)
}

const jsonLines = process.argv.includes('--json-lines')
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  while (true) {
    const frame = readFrame(buffer) ?? readJsonLine(buffer)
    if (!frame) return
    buffer = frame.rest
    handleMessage(frame.body)
  }
})

function handleMessage(text) {
  const message = JSON.parse(text)
  if (message.id === undefined) return
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'FakePandoMcp',
          version: '0.1.0',
        },
        capabilities: {
          tools: {},
        },
      })
      return
    case 'tools/list':
      respond(message.id, {
        tools: [
          {
            name: 'echo',
            description: 'Echo text.',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
              },
            },
          },
          {
            name: 'uia_action',
            description: 'Fake UIA action.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string' },
              },
            },
          },
          {
            name: 'visual_action_with_wait',
            description: 'Fake visual action.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string' },
              },
            },
          },
          {
            name: 'visual_screenshot',
            description: 'Fake screenshot.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          ...humanGuiTools(),
        ],
      })
      return
    case 'tools/call':
      respond(message.id, toolResult(message.params ?? {}))
      return
    default:
      respondError(message.id, -32601, `Unknown method: ${message.method}`)
  }
}

function toolResult(params) {
  const name = params.name
  const args = params.arguments ?? {}
  if (name === 'echo') {
    return {
      content: [
        {
          type: 'text',
          text: String(args.text ?? 'echo-ok'),
        },
      ],
    }
  }
  if (name === 'uia_action') {
    if (args.action === 'force_visual' || args.target === 'force_visual') {
      return {
        ok: false,
        message: 'uia failed',
        failureClass: 'uia_failed',
      }
    }
    return {
      ok: true,
      message: `uia ${args.action ?? 'action'} ok`,
    }
  }
  if (name === 'visual_action_with_wait') {
    return {
      ok: true,
      message: `visual ${args.action ?? 'action'} ok`,
      screenshotPath: '.tmp/fake-visual.png',
    }
  }
  if (name === 'visual_screenshot') {
    return {
      ok: args.action !== 'verify_fail',
      message: args.action === 'verify_fail' ? 'verification failed' : 'screenshot ok',
      screenshotPath: '.tmp/fake-screenshot.png',
      failureClass: args.action === 'verify_fail' ? 'verification_failed' : undefined,
    }
  }
  if (name === 'human_gui_observe') {
    return textPayload({
      ok: true,
      observationId: 'obs_fake',
      imagePath: '.tmp/fake-human-observe.png',
      width: 100,
      height: 100,
      message: 'human observe ok',
    })
  }
  if (name === 'human_gui_wait') {
    return textPayload({
      ok: true,
      afterObservationId: 'obs_wait',
      afterImagePath: '.tmp/fake-human-wait.png',
      message: 'human wait ok',
    })
  }
  if (name === 'human_gui_wait_for_change') {
    return textPayload({
      ok: true,
      afterObservationId: 'obs_changed',
      afterImagePath: '.tmp/fake-human-change.png',
      message: 'human change ok',
    })
  }
  if (name === 'human_gui_wait_until_stable') {
    return textPayload({
      ok: true,
      afterObservationId: 'obs_stable',
      afterImagePath: '.tmp/fake-human-stable.png',
      message: 'human stable ok',
    })
  }
  if (name === 'human_gui_release_all') {
    return textPayload({
      ok: true,
      afterObservationId: 'obs_release',
      afterImagePath: '.tmp/fake-human-release.png',
      message: 'human release ok',
    })
  }
  if (name === 'human_gui_analyze_grid') {
    return textPayload({
      ok: true,
      observationId: args.observationId,
      annotatedImagePath: '.tmp/fake-human-grid.png',
      message: 'human grid ok',
    })
  }
  if (name === 'human_gui_fast_click') {
    return textPayload({
      ok: true,
      tool: 'human_gui_fast_click',
      actionId: 'action_fast_click',
      afterObservationId: 'obs_fast_click',
      afterImagePath: '.tmp/fake-human-fast-click.png',
      toolDiscipline: {
        confirmationMode: 'fast',
        autoConfirmed: true,
      },
      visualReview: {
        classification: 'changed',
        failureClass: null,
      },
      postActionVerification: {
        expectedChange: 'optional',
        passed: true,
      },
      message: 'human fast click ok',
    })
  }
  if (name === 'human_gui_reflex_click') {
    return textPayload({
      ok: true,
      tool: 'human_gui_reflex_click',
      actionId: 'action_reflex_click',
      afterObservationId: 'obs_reflex_click',
      afterImagePath: '.tmp/fake-human-reflex-click.png',
      toolDiscipline: {
        mode: 'reflex',
      },
      message: 'human reflex click ok',
    })
  }
  if (name === 'human_gui_set_mouse_button_state') {
    return textPayload({
      ok: true,
      tool: 'human_gui_set_mouse_button_state',
      actionId: 'action_mouse_button_state',
      afterObservationId: 'obs_mouse_button_state',
      afterImagePath: '.tmp/fake-human-mouse-button-state.png',
      toolDiscipline: {
        bypassed: true,
        reason: 'fake mouse up without point',
      },
      message: 'human mouse button state ok',
    })
  }
  if (name === 'human_gui_compare_observations') {
    return textPayload({
      ok: true,
      diffImagePath: '.tmp/fake-human-diff.png',
      message: 'human compare ok',
    })
  }
  if (name === 'human_gui_run_sequence') {
    return fakeHumanSequence(args)
  }
  return {
    content: [
      {
        type: 'text',
        text: `called ${name}`,
      },
    ],
  }
}

function humanGuiTools() {
  return [
    'human_gui_observe',
    'human_gui_mark_point',
    'human_gui_confirm_point',
    'human_gui_analyze_grid',
    'human_gui_fast_click',
    'human_gui_reflex_click',
    'human_gui_execute_click',
    'human_gui_execute_mouse',
    'human_gui_draw_path',
    'human_gui_draw_paths',
    'human_gui_execute_keys',
    'human_gui_set_key_state',
    'human_gui_set_mouse_button_state',
    'human_gui_type_text',
    'human_gui_wait',
    'human_gui_wait_for_change',
    'human_gui_wait_until_stable',
    'human_gui_compare_observations',
    'human_gui_release_all',
    'human_gui_run_sequence',
  ].map(name => ({
    name,
    description: `Fake ${name}.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }))
}

function fakeHumanSequence(args) {
  const steps = Array.isArray(args.steps) ? args.steps : []
  const results = steps.map((step, index) => {
    const id = String(step.id ?? `step_${index + 1}`)
    const tool = String(step.tool ?? 'unknown')
    const payload = fakeHumanStepPayload(id, tool)
    return {
      index,
      id,
      tool,
      ok: payload.ok,
      result: payload,
    }
  })
  return textPayload({
    ok: true,
    tool: 'human_gui_run_sequence',
    sequenceId: 'sequence_fake',
    stepCount: steps.length,
    attemptedStepCount: steps.length,
    completedStepCount: steps.length,
    results,
    message: `Sequence completed: ${steps.map(step => String(step.tool ?? 'unknown')).join(', ')}`,
  })
}

function fakeHumanStepPayload(id, tool) {
  if (tool === 'human_gui_observe') {
    return {
      ok: true,
      observationId: 'obs_fake',
      imagePath: '.tmp/fake-human-observe.png',
      message: 'observe ok',
    }
  }
  if (tool === 'human_gui_mark_point') {
    return {
      ok: true,
      markId: 'mark_fake',
      markedImagePath: '.tmp/fake-human-mark.png',
      message: 'mark ok',
    }
  }
  if (tool === 'human_gui_confirm_point') {
    return {
      ok: true,
      confirmationId: 'confirm_fake',
      message: 'confirm ok',
    }
  }
  return {
    ok: true,
    tool,
    actionId: `action_${id}`,
    afterObservationId: 'obs_after',
    afterImagePath: '.tmp/fake-human-after.png',
    toolDiscipline: {
      confirmationId: 'confirm_fake',
      bypassed: false,
    },
    focusDiscipline: tool === 'human_gui_type_text' || tool === 'human_gui_execute_keys' || tool === 'human_gui_set_key_state'
      ? {
          focused: true,
          bypassed: false,
        }
      : undefined,
    visualReview: {
      classification: 'changed',
      failureClass: null,
    },
    postActionVerification: {
      expectedChange: 'optional',
      passed: true,
    },
    message: `${tool} ok`,
  }
}

function textPayload(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload),
      },
    ],
  }
}

function respond(id, result) {
  writeFrame({
    jsonrpc: '2.0',
    id,
    result,
  })
}

function respondError(id, code, message) {
  writeFrame({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  })
}

function writeFrame(payload) {
  const text = JSON.stringify(payload)
  if (jsonLines) {
    process.stdout.write(`${text}\n`)
    return
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(text, 'utf8')}\r\n\r\n${text}`)
}

function readFrame(value) {
  const headerEnd = value.indexOf('\r\n\r\n')
  if (headerEnd === -1) return undefined
  const header = value.slice(0, headerEnd)
  const match = /^Content-Length:\s*(\d+)/im.exec(header)
  if (!match) return undefined
  const length = Number(match[1])
  const bodyStart = headerEnd + 4
  const bodyEnd = bodyStart + length
  if (value.length < bodyEnd) return undefined
  return {
    body: value.slice(bodyStart, bodyEnd),
    rest: value.slice(bodyEnd),
  }
}

function readJsonLine(value) {
  const newline = value.indexOf('\n')
  if (newline === -1) return undefined
  const line = value.slice(0, newline).trim()
  const rest = value.slice(newline + 1)
  if (!line) return { body: '{}', rest }
  if (!line.startsWith('{')) return undefined
  return {
    body: line,
    rest,
  }
}
