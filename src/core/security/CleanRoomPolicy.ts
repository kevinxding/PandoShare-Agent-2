export function cleanRoomRules(): string[] {
  return [
    'Study behavior, contracts, and architecture patterns; write original implementation in this repository.',
    'Do not paste proprietary source, prompts, comments, or text from Claude Code research material.',
    'When copying from permissive projects, preserve license and NOTICE obligations.',
    'Record provenance and copied-file decisions in NOTICE/THIRD_PARTY documentation.',
  ]
}

export function permissionThreatBoundaries(): string[] {
  return [
    'read-only profile must not write files',
    'workspace-write must not write outside approved workspace roots',
    'dangerous GUI actions require approval',
    'gateway outbound must use a durable queue and approval boundary',
    'replay must not execute recovery side effects',
    'model events must not persist secrets',
  ]
}
