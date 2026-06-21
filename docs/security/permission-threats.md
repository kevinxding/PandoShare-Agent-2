# Permission Threats

- read-only profile must not write files
- workspace-write must not write outside approved roots
- dangerous GUI actions require approval
- gateway outbound requires durable queue and approval boundaries
- replay must not execute recovery side effects
- model events must not persist secrets
