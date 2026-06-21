# Security Acceptance Report

Status: blocked baseline

## Secret Scan

- Scanned files: 648
- Findings: 42

## License Audit

- Package: pandoshare-agent
- Private package: true
- License status: missing

## Blockers

- LICENSE missing: owner must choose MIT, Apache-2.0, or another license before public release claims.
- not publishable until owner changes private flag

## Boundaries

- read-only profile must not write files
- workspace-write must not write outside approved workspace roots
- dangerous GUI actions require approval
- gateway outbound must use a durable queue and approval boundary
- replay must not execute recovery side effects
- model events must not persist secrets
