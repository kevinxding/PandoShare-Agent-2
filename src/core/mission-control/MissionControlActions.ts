import type { BackendAction } from '../backend/index.js'
import type { MissionControlAction } from './MissionControlTypes.js'

const ACTION_MAP: Record<MissionControlAction, BackendAction> = {
  'agent.stop': 'agent.interrupt',
  'loop.runNext': 'loop.runNext',
  'loop.recover': 'loop.recover',
  'gateway.tick': 'gateway.tick',
  'gateway.retryOutbound': 'gateway.tick',
  'gui.releaseInput': 'gui.requestAction',
  'gui.approve': 'gui.approve',
  'gui.reject': 'gui.reject',
  'model.route': 'model.route',
  'replay.export': 'replay.export',
  'system.health': 'system.health',
}

export function toBackendAction(action: string): BackendAction {
  if (!isMissionControlAction(action)) throw new Error('Unsupported Mission Control action: ' + action)
  return ACTION_MAP[action]
}

export function isMissionControlAction(action: string): action is MissionControlAction {
  return Object.prototype.hasOwnProperty.call(ACTION_MAP, action)
}

export function listMissionControlActions(): MissionControlAction[] {
  return Object.keys(ACTION_MAP) as MissionControlAction[]
}
