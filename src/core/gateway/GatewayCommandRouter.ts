import { createCommandEnvelope, type CommandEnvelope } from '../protocol/index.js'
import type { GatewayInboundEnvelope } from './GatewayEnvelope.js'
import type { GatewayCommandRoute, GatewayInboundMessage } from './GatewayTypes.js'

type RouteMessage = GatewayInboundEnvelope | GatewayInboundMessage

export class GatewayCommandRouter {
  constructor(private readonly workspaceId: string) {}

  route(message: RouteMessage): GatewayCommandRoute {
    const normalized = normalizeMessage(message)
    const text = normalized.text.trim()
    if (!text.startsWith('/')) {
      return this.command(normalized, 'agent.run', { prompt: normalized.text, message: normalized }, `queued agent.run`)
    }

    const [command = '', ...rest] = text.split(/\s+/)
    const argumentText = rest.join(' ')
    const lower = command.toLowerCase()
    switch (lower) {
      case '/status':
        return this.command(normalized, 'gateway.status', { message: normalized }, 'Pando gateway status requested.')
      case '/health':
        return this.command(normalized, 'gateway.health', { message: normalized }, 'Pando gateway health requested.')
      case '/usage':
        return this.command(normalized, 'gateway.usage', { message: normalized }, 'Pando gateway usage requested.')
      case '/goal':
        return this.command(normalized, 'loop.create', { objective: argumentText || 'Gateway goal', message: normalized }, `queued loop.create`)
      case '/loops':
        return this.command(normalized, 'loop.list', { message: normalized }, 'Pando loop list requested.')
      case '/loop':
        return this.command(normalized, 'loop.status', { loopId: rest[0], message: normalized }, 'Pando loop status requested.', { loopId: rest[0] })
      case '/resume':
        return this.command(normalized, 'loop.resume', { loopId: rest[0], message: normalized }, `queued loop.resume`, { loopId: rest[0] })
      case '/background':
        return this.command(normalized, 'gateway.background.enroll', { loopId: rest[0], message: normalized }, `queued gateway.background.enroll`, { loopId: rest[0] })
      case '/pause':
        return this.command(normalized, 'loop.pause', { loopId: rest[0], reason: argumentText, message: normalized }, `queued loop.pause`, { loopId: rest[0] })
      case '/stop':
        return this.routeStop(normalized, rest, argumentText)
      case '/approve':
        return this.command(normalized, 'approval.resolve', { approvalId: rest[0], decision: 'approve', kind: 'generic', message: normalized }, `queued approval.resolve`)
      case '/deny':
        return this.command(normalized, 'approval.resolve', { approvalId: rest[0], decision: 'deny', kind: 'generic', message: normalized }, `queued approval.resolve`)
      case '/gui':
        return this.routeGui(normalized, rest)
      case '/model':
        return rest.length
          ? this.command(normalized, 'gateway.model.switch', { provider: rest[0], model: rest[1], message: normalized }, 'Gateway model switch requested.')
          : this.command(normalized, 'gateway.model.status', { message: normalized }, 'Gateway model status requested.')
      case '/compress':
        return this.command(normalized, 'thread.compact', { threadId: rest[0], reason: 'gateway_manual', message: normalized }, `queued thread.compact`, { threadId: rest[0] })
      case '/threads':
        return this.command(normalized, 'thread.list', { message: normalized }, 'Pando threads requested.')
      case '/replay':
        return this.command(normalized, 'replay.read', { targetId: rest[0], message: normalized }, 'Pando replay requested.')
      case '/pair':
        return this.command(normalized, 'gateway.pair', { secret: rest[0], message: normalized }, 'Gateway pairing requested.')
      case '/unpair':
        return this.command(normalized, 'gateway.unpair', { message: normalized }, 'Gateway unpair requested.')
      case '/help':
        return this.command(normalized, 'gateway.help', { message: normalized }, helpText())
      default:
        return this.command(normalized, 'gateway.command.unknown', { command, argumentText, message: normalized }, `Unknown gateway command: ${command}. Try /help.`, undefined, false)
    }
  }

  private routeGui(message: NormalizedGatewayMessage, rest: string[]): GatewayCommandRoute {
    const action = rest[0]?.toLowerCase()
    const guiActionId = rest[1]
    if (action === 'approve') return this.command(message, 'gui.approve', { guiActionId, message }, `queued gui.approve`)
    if (action === 'deny') return this.command(message, 'gui.reject', { guiActionId, message }, `queued gui.reject`)
    return this.command(message, 'gateway.command.unknown', { command: '/gui', argumentText: rest.join(' '), message }, 'Unknown GUI command. Try /gui approve <guiActionId> or /gui deny <guiActionId>.', undefined, false)
  }

  private routeStop(message: NormalizedGatewayMessage, rest: string[], argumentText: string): GatewayCommandRoute {
    const targetId = rest[0]
    if (targetId?.startsWith('loop_')) return this.command(message, 'loop.stop', { loopId: targetId, reason: argumentText, message }, `queued loop.stop`, { loopId: targetId })
    if (targetId?.startsWith('run_')) return this.command(message, 'agent.stop', { runId: targetId, reason: argumentText, message }, `queued agent.stop`, { runId: targetId })
    return this.command(message, 'gateway.stop', { targetId, reason: argumentText || 'Gateway stop command.', message }, 'Gateway stop requested.')
  }

  private command(
    message: NormalizedGatewayMessage,
    commandType: string,
    payload: unknown,
    replyText?: string,
    ids: { threadId?: string; runId?: string; goalId?: string; loopId?: string } = {},
    known = true,
  ): GatewayCommandRoute {
    return {
      command: createCommandEnvelope({
        commandType,
        workspaceId: this.workspaceId,
        source: 'gateway',
        threadId: ids.threadId,
        runId: ids.runId,
        goalId: ids.goalId,
        loopId: ids.loopId,
        payload,
      }),
      replyText,
      inboundId: message.inboundId,
      known,
    }
  }
}

type NormalizedGatewayMessage = {
  inboundId?: string
  messageId?: string
  channelId: string
  channelKind: string
  userId: string
  text: string
  createdAtMs: number
}

function normalizeMessage(message: RouteMessage): NormalizedGatewayMessage {
  if ('inboundId' in message) {
    return {
      inboundId: message.inboundId,
      channelId: message.channelId,
      channelKind: message.channelKind,
      userId: message.userId,
      text: message.text,
      createdAtMs: message.createdAtMs,
    }
  }
  return {
    messageId: message.messageId,
    channelId: message.channel,
    channelKind: message.channel,
    userId: message.userId,
    text: message.text,
    createdAtMs: message.createdAtMs,
  }
}

function helpText(): string {
  return [
    'Pando gateway commands:',
    '/status /health /usage /threads /loops /model',
    '/goal <objective> /resume <loopId> /background <loopId> /pause <loopId> /stop [runId|loopId]',
    '/approve <id> /deny <id> /gui approve <guiActionId> /gui deny <guiActionId>',
    '/compress <threadId> /replay <runId|loopId> /pair <secret> /unpair',
  ].join('\n')
}
