# Security Policy

This project is in local-first productization baseline status. Do not expose the server on an untrusted network without adding authentication, authorization, CSRF protection, and deployment hardening.

## Reporting

Report suspected vulnerabilities through the repository issue tracker until a private security contact is configured.

## Baseline Controls

- Secret-bearing fields must be redacted in events, reports, and Mission Control responses.
- Dangerous GUI and gateway outbound actions require approval in production wiring.
- Replay must not execute recovery side effects.
