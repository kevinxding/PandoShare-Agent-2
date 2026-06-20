import type { ToolDefinition } from '../../Tool.js'
import { createTextResult } from '../../Tool.js'
import { emitAgentEvent, eventBase } from '../../services/events/index.js'
import { LocalGoalStore } from '../../services/goalStore/index.js'
import { runGuiAction, type GuiActionBackend, type GuiActionRequest } from '../../services/gui/index.js'

export const GuiTool: ToolDefinition = {
  name: 'gui_action',
  description: 'Run a verified GUI action through UIA, visual fallback, and screenshot validation.',
  safety: 'gui_write',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
      },
      target: {
        type: 'string',
      },
      text: {
        type: 'string',
      },
      keys: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      points: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
      },
      strokes: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['x', 'y'],
            additionalProperties: false,
          },
        },
      },
      region: {
        type: 'object',
        properties: {
          left: { type: 'number' },
          top: { type: 'number' },
          right: { type: 'number' },
          bottom: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['left', 'top'],
        additionalProperties: false,
      },
      observationId: {
        type: 'string',
      },
      beforeObservationId: {
        type: 'string',
      },
      afterObservationId: {
        type: 'string',
      },
      x: {
        type: 'number',
      },
      y: {
        type: 'number',
      },
      coordinateSpace: {
        type: 'string',
        enum: ['screen', 'image', 'foreground_window'],
      },
      button: {
        type: 'string',
        enum: ['left', 'right', 'middle'],
      },
      clicks: {
        type: 'number',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
      },
      wheelTimes: {
        type: 'number',
      },
      state: {
        type: 'string',
        enum: ['down', 'up'],
      },
      confidence: {
        type: 'number',
      },
      minConfidence: {
        type: 'number',
      },
      durationMs: {
        type: 'number',
      },
      maxClicks: {
        type: 'number',
      },
      targetColor: {
        type: 'string',
        enum: ['red', 'green', 'blue', 'blue_overlay', 'brown', 'dark', 'light'],
      },
      selectedColor: {
        type: 'string',
        enum: ['red', 'green', 'blue', 'blue_overlay', 'brown', 'dark', 'light'],
      },
      lineColor: {
        type: 'string',
        enum: ['red', 'green', 'blue', 'blue_overlay', 'brown', 'dark', 'light'],
      },
      clear: {
        type: 'boolean',
      },
      pressEnter: {
        type: 'boolean',
      },
      forceUnicode: {
        type: 'boolean',
      },
      timeoutMs: {
        type: 'number',
      },
      verify: {
        oneOf: [
          { type: 'boolean' },
          { type: 'string' },
        ],
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validateInput(toolUse) {
    const action = toolUse.input.action
    if (typeof action !== 'string' || !action.trim()) {
      return {
        ok: false,
        message: 'action must be a non-empty string',
      }
    }
    return { ok: true }
  },
  async execute(toolUse, context) {
    const request = normalizeGuiActionRequest(toolUse.input)
    await emitAgentEvent(context, {
      ...eventBase(context, 'gui_action_started'),
      type: 'gui_action_started',
      toolUseId: toolUse.id,
      action: request.action,
      target: request.target,
    })

    const backend = context.metadata?.guiBackend as GuiActionBackend | undefined
    const result = await runGuiAction(request, backend)
    if (request.verify) {
      await emitAgentEvent(context, {
        ...eventBase(context, 'gui_action_verified'),
        type: 'gui_action_verified',
        toolUseId: toolUse.id,
        ok: result.ok,
        screenshotPath: result.screenshotPath,
        message: result.ok ? 'GUI verification completed.' : result.message,
        audit: result.audit,
      })
    }

    if (!result.ok) {
      await emitAgentEvent(context, {
        ...eventBase(context, 'gui_action_failed'),
        type: 'gui_action_failed',
        toolUseId: toolUse.id,
        method: result.method,
        message: result.message,
        failureClass: result.failureClass,
        audit: result.audit,
      })
    }

    await emitAgentEvent(context, {
      ...eventBase(context, 'gui_action_completed'),
      type: 'gui_action_completed',
      toolUseId: toolUse.id,
      ok: result.ok,
      method: result.method,
      fallbackUsed: Boolean(result.fallbackUsed),
      message: result.message,
      screenshotPath: result.screenshotPath,
      failureClass: result.failureClass,
      audit: result.audit,
    })

    const goalId = typeof context.metadata?.goalId === 'string' ? context.metadata.goalId : undefined
    if (goalId && result.ok) {
      const goalStore = new LocalGoalStore(context.cwd)
      await goalStore.appendEvidence(goalId, {
        type: 'gui',
        strength: 'indirect',
        summary: `GUI action ${request.action} completed: ${result.message}`,
        threadId: context.threadId,
        guiActionId: toolUse.id,
        path: result.screenshotPath ?? result.audit?.afterImagePath ?? result.audit?.annotatedImagePath ?? result.audit?.diffImagePath,
        metadata: {
          method: result.method,
          fallbackUsed: Boolean(result.fallbackUsed),
          failureClass: result.failureClass,
          audit: result.audit,
        },
      })
    }

    return createTextResult(toolUse.id, JSON.stringify(result, null, 2), result.ok)
  },
}

function normalizeGuiActionRequest(input: Record<string, unknown>): GuiActionRequest {
  return {
    action: String(input.action ?? '').trim(),
    target: typeof input.target === 'string' ? input.target : undefined,
    text: typeof input.text === 'string' ? input.text : undefined,
    keys: Array.isArray(input.keys) ? input.keys.filter((key): key is string => typeof key === 'string') : undefined,
    points: normalizePoints(input.points),
    strokes: normalizeStrokes(input.strokes),
    region: normalizeRegion(input.region),
    observationId: typeof input.observationId === 'string' ? input.observationId : undefined,
    beforeObservationId: typeof input.beforeObservationId === 'string' ? input.beforeObservationId : undefined,
    afterObservationId: typeof input.afterObservationId === 'string' ? input.afterObservationId : undefined,
    x: typeof input.x === 'number' ? input.x : undefined,
    y: typeof input.y === 'number' ? input.y : undefined,
    coordinateSpace: isCoordinateSpace(input.coordinateSpace) ? input.coordinateSpace : undefined,
    button: isButton(input.button) ? input.button : undefined,
    clicks: typeof input.clicks === 'number' ? input.clicks : undefined,
    direction: isDirection(input.direction) ? input.direction : undefined,
    wheelTimes: typeof input.wheelTimes === 'number' ? input.wheelTimes : undefined,
    state: isState(input.state) ? input.state : undefined,
    confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
    minConfidence: typeof input.minConfidence === 'number' ? input.minConfidence : undefined,
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
    maxClicks: typeof input.maxClicks === 'number' ? input.maxClicks : undefined,
    targetColor: isGuiColor(input.targetColor) ? input.targetColor : undefined,
    selectedColor: isGuiColor(input.selectedColor) ? input.selectedColor : undefined,
    lineColor: isGuiColor(input.lineColor) ? input.lineColor : undefined,
    clear: typeof input.clear === 'boolean' ? input.clear : undefined,
    pressEnter: typeof input.pressEnter === 'boolean' ? input.pressEnter : undefined,
    forceUnicode: typeof input.forceUnicode === 'boolean' ? input.forceUnicode : undefined,
    timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
    verify: typeof input.verify === 'boolean' || typeof input.verify === 'string' ? input.verify : undefined,
  }
}

function normalizePoints(value: unknown): GuiActionRequest['points'] {
  if (!Array.isArray(value)) return undefined
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    return typeof record.x === 'number' && typeof record.y === 'number'
      ? [{ x: record.x, y: record.y }]
      : []
  })
}

function normalizeStrokes(value: unknown): GuiActionRequest['strokes'] {
  if (!Array.isArray(value)) return undefined
  return value.flatMap(item => {
    const points = normalizePoints(item)
    return points?.length ? [points] : []
  })
}

function normalizeRegion(value: unknown): GuiActionRequest['region'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.left !== 'number' || typeof record.top !== 'number') return undefined
  return {
    left: record.left,
    top: record.top,
    right: typeof record.right === 'number' ? record.right : undefined,
    bottom: typeof record.bottom === 'number' ? record.bottom : undefined,
    width: typeof record.width === 'number' ? record.width : undefined,
    height: typeof record.height === 'number' ? record.height : undefined,
  }
}

function isCoordinateSpace(value: unknown): value is GuiActionRequest['coordinateSpace'] {
  return value === 'screen' || value === 'image' || value === 'foreground_window'
}

function isButton(value: unknown): value is GuiActionRequest['button'] {
  return value === 'left' || value === 'right' || value === 'middle'
}

function isDirection(value: unknown): value is GuiActionRequest['direction'] {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

function isState(value: unknown): value is GuiActionRequest['state'] {
  return value === 'down' || value === 'up'
}

function isGuiColor(value: unknown): value is GuiActionRequest['targetColor'] {
  return value === 'red'
    || value === 'green'
    || value === 'blue'
    || value === 'blue_overlay'
    || value === 'brown'
    || value === 'dark'
    || value === 'light'
}
