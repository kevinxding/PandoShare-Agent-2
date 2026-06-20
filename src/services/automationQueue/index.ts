import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AutomationStatus = 'scheduled' | 'queued' | 'sent' | 'processed' | 'failed' | 'disabled'

export type AutomationSchedule = {
  scheduleId: string
  schedule: string
  command: string
  status: AutomationStatus
  createdAtMs: number
  updatedAtMs: number
  nextRunAtMs: number
  lastRunAtMs?: number
  runCount: number
  goalId?: string
  taskId?: string
  loopId?: string
}

export type AutomationTrigger = {
  triggerId: string
  channel: string
  payload: string
  status: AutomationStatus
  createdAtMs: number
  updatedAtMs: number
  processedAtMs?: number
  goalId?: string
  taskId?: string
}

export type AutomationMessage = {
  messageId: string
  channel: string
  recipient: string
  text: string
  status: AutomationStatus
  createdAtMs: number
  updatedAtMs: number
  sentAtMs?: number
  goalId?: string
  taskId?: string
}

export type AutomationSnapshot = {
  schedules: AutomationSchedule[]
  triggers: AutomationTrigger[]
  messages: AutomationMessage[]
}

const AUTOMATION_DIR = '.pandoshare/automation'
const SCHEDULES_FILE = 'schedules.jsonl'
const TRIGGERS_FILE = 'triggers.jsonl'
const MESSAGES_FILE = 'messages.jsonl'

export class LocalAutomationQueue {
  readonly root: string

  constructor(readonly workspaceRoot: string) {
    this.root = join(workspaceRoot, AUTOMATION_DIR)
  }

  async createSchedule(input: {
    scheduleId?: string
    schedule: string
    command: string
    goalId?: string
    taskId?: string
    loopId?: string
  }): Promise<AutomationSchedule> {
    const now = Date.now()
    const schedule: AutomationSchedule = {
      scheduleId: sanitizeId(input.scheduleId ?? `schedule_${now}_${shortId()}`, 'scheduleId'),
      schedule: requiredText(input.schedule, 'schedule'),
      command: normalizeGatewayCommand(requiredText(input.command, 'command')),
      status: 'scheduled',
      createdAtMs: now,
      updatedAtMs: now,
      nextRunAtMs: nextRunAtMs(input.schedule, now),
      runCount: 0,
      goalId: optionalId(input.goalId),
      taskId: optionalId(input.taskId),
      loopId: optionalId(input.loopId),
    }
    await this.append(SCHEDULES_FILE, schedule)
    return schedule
  }

  async createTrigger(input: {
    triggerId?: string
    channel: string
    payload: string
    goalId?: string
    taskId?: string
  }): Promise<AutomationTrigger> {
    const now = Date.now()
    const trigger: AutomationTrigger = {
      triggerId: sanitizeId(input.triggerId ?? `trigger_${now}_${shortId()}`, 'triggerId'),
      channel: requiredText(input.channel, 'channel'),
      payload: normalizeGatewayCommand(requiredText(input.payload, 'payload')),
      status: 'queued',
      createdAtMs: now,
      updatedAtMs: now,
      goalId: optionalId(input.goalId),
      taskId: optionalId(input.taskId),
    }
    await this.append(TRIGGERS_FILE, trigger)
    return trigger
  }

  async createMessage(input: {
    messageId?: string
    channel: string
    recipient?: string
    text: string
    goalId?: string
    taskId?: string
  }): Promise<AutomationMessage> {
    const now = Date.now()
    const message: AutomationMessage = {
      messageId: sanitizeId(input.messageId ?? `message_${now}_${shortId()}`, 'messageId'),
      channel: requiredText(input.channel, 'channel'),
      recipient: input.recipient?.trim() || 'default',
      text: requiredText(input.text, 'text'),
      status: 'queued',
      createdAtMs: now,
      updatedAtMs: now,
      goalId: optionalId(input.goalId),
      taskId: optionalId(input.taskId),
    }
    await this.append(MESSAGES_FILE, message)
    return message
  }

  async dueSchedules(now = Date.now()): Promise<AutomationSchedule[]> {
    const schedules = await this.readSchedules()
    return schedules.filter(schedule => schedule.status === 'scheduled' && schedule.nextRunAtMs <= now)
  }

  async queuedTriggers(): Promise<AutomationTrigger[]> {
    return (await this.readTriggers()).filter(trigger => trigger.status === 'queued')
  }

  async queuedMessages(): Promise<AutomationMessage[]> {
    return (await this.readMessages()).filter(message => message.status === 'queued')
  }

  async markScheduleRun(scheduleId: string, now = Date.now()): Promise<AutomationSchedule> {
    const schedules = await this.readSchedules()
    const index = schedules.findIndex(schedule => schedule.scheduleId === scheduleId)
    if (index === -1) throw new Error(`Schedule not found: ${scheduleId}`)
    const current = schedules[index]!
    const oneShot = isOneShotSchedule(current.schedule)
    const next: AutomationSchedule = {
      ...current,
      status: oneShot ? 'processed' : current.status,
      lastRunAtMs: now,
      updatedAtMs: now,
      nextRunAtMs: oneShot ? Number.MAX_SAFE_INTEGER : nextRunAtMs(current.schedule, now),
      runCount: current.runCount + 1,
    }
    schedules[index] = next
    await this.write(SCHEDULES_FILE, schedules)
    return next
  }

  async markTriggerProcessed(triggerId: string, status: AutomationStatus = 'processed'): Promise<AutomationTrigger> {
    const triggers = await this.readTriggers()
    const index = triggers.findIndex(trigger => trigger.triggerId === triggerId)
    if (index === -1) throw new Error(`Trigger not found: ${triggerId}`)
    const now = Date.now()
    const next: AutomationTrigger = {
      ...triggers[index]!,
      status,
      processedAtMs: now,
      updatedAtMs: now,
    }
    triggers[index] = next
    await this.write(TRIGGERS_FILE, triggers)
    return next
  }

  async markMessageSent(messageId: string, status: AutomationStatus = 'sent'): Promise<AutomationMessage> {
    const messages = await this.readMessages()
    const index = messages.findIndex(message => message.messageId === messageId)
    if (index === -1) throw new Error(`Message not found: ${messageId}`)
    const now = Date.now()
    const next: AutomationMessage = {
      ...messages[index]!,
      status,
      sentAtMs: now,
      updatedAtMs: now,
    }
    messages[index] = next
    await this.write(MESSAGES_FILE, messages)
    return next
  }

  async readSnapshot(limit = 50): Promise<AutomationSnapshot> {
    const [schedules, triggers, messages] = await Promise.all([
      this.readSchedules(),
      this.readTriggers(),
      this.readMessages(),
    ])
    return {
      schedules: schedules.sort(sortByUpdated).slice(0, limit),
      triggers: triggers.sort(sortByUpdated).slice(0, limit),
      messages: messages.sort(sortByUpdated).slice(0, limit),
    }
  }

  readSchedules(): Promise<AutomationSchedule[]> {
    return this.read<AutomationSchedule>(SCHEDULES_FILE)
  }

  readTriggers(): Promise<AutomationTrigger[]> {
    return this.read<AutomationTrigger>(TRIGGERS_FILE)
  }

  readMessages(): Promise<AutomationMessage[]> {
    return this.read<AutomationMessage>(MESSAGES_FILE)
  }

  private async append(filename: string, record: unknown): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await appendFile(join(this.root, filename), `${JSON.stringify(record)}\n`, 'utf8')
  }

  private async read<T>(filename: string): Promise<T[]> {
    await mkdir(this.root, { recursive: true })
    try {
      const text = await readFile(join(this.root, filename), 'utf8')
      return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .flatMap(line => {
          try {
            return [JSON.parse(line) as T]
          } catch {
            return []
          }
        })
    } catch {
      return []
    }
  }

  private async write(filename: string, records: readonly unknown[]): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, filename), records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8')
  }
}

export function normalizeGatewayCommand(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) throw new Error('command must be a non-empty string')
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function nextRunAtMs(schedule: string, now: number): number {
  const trimmed = schedule.trim()
  if (isOneShotSchedule(trimmed)) return now
  const everyMatch = /^@every\s+(\d+)(ms|s|m|h)$/.exec(trimmed)
  if (everyMatch) return now + durationMs(Number(everyMatch[1]), everyMatch[2]!)
  const minuteMatch = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(trimmed)
  if (minuteMatch) return now + durationMs(Number(minuteMatch[1]), 'm')
  throw new Error('schedule must be @once, @now, @every <n>ms|s|m|h, or */N * * * *')
}

function isOneShotSchedule(schedule: string): boolean {
  const trimmed = schedule.trim()
  return trimmed === '@once' || trimmed === '@now'
}

function durationMs(value: number, unit: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error('schedule interval must be a positive integer')
  if (unit === 'ms') return value
  if (unit === 's') return value * 1000
  if (unit === 'm') return value * 60_000
  if (unit === 'h') return value * 3_600_000
  throw new Error(`Unsupported schedule unit: ${unit}`)
}

function requiredText(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function optionalId(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid id: ${value}`)
  return value
}

function sanitizeId(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${name}: ${value}`)
  return value
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8)
}

function sortByUpdated<T extends { updatedAtMs: number }>(a: T, b: T): number {
  return b.updatedAtMs - a.updatedAtMs
}
