export const GATEWAY_EVENT_TYPES = {
  daemonStarted: 'gateway_daemon_started',
  daemonStopped: 'gateway_daemon_stopped',
  daemonFailed: 'gateway_daemon_failed',
  daemonRecovered: 'gateway_daemon_recovered',
  heartbeat: 'gateway_heartbeat',
  channelRegistered: 'gateway_channel_registered',
  channelConnected: 'gateway_channel_connected',
  channelDisconnected: 'gateway_channel_disconnected',
  channelReconnecting: 'gateway_channel_reconnecting',
  channelFailed: 'gateway_channel_failed',
  inboundReceived: 'gateway_inbound_received',
  inboundDeduped: 'gateway_inbound_deduped',
  inboundDenied: 'gateway_inbound_denied',
  inboundRouted: 'gateway_inbound_routed',
  commandCreated: 'gateway_command_created',
  commandDispatched: 'gateway_command_dispatched',
  commandFailed: 'gateway_command_failed',
  outboundQueued: 'gateway_outbound_queued',
  outboundSending: 'gateway_outbound_sending',
  outboundDelivered: 'gateway_outbound_delivered',
  outboundFailed: 'gateway_outbound_failed',
  outboundRetryScheduled: 'gateway_outbound_retry_scheduled',
  userPaired: 'gateway_user_paired',
  userUnpaired: 'gateway_user_unpaired',
  approvalRequested: 'gateway_approval_requested',
  approvalResolved: 'gateway_approval_resolved',
  loopWakeRequested: 'gateway_loop_wake_requested',
  loopWakeCompleted: 'gateway_loop_wake_completed',
  guiApprovalForwarded: 'gateway_gui_approval_forwarded',
  recoveryEscalated: 'gateway_recovery_escalated',
  healthReported: 'gateway_health_reported',
  legacyEventBridged: 'gateway_legacy_event_bridged',
} as const

export type GatewayEventType = typeof GATEWAY_EVENT_TYPES[keyof typeof GATEWAY_EVENT_TYPES]

export function isGatewayEventType(value: string): value is GatewayEventType {
  return Object.values(GATEWAY_EVENT_TYPES).includes(value as GatewayEventType)
}
