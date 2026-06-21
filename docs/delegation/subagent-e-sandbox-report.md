# SubAgent E Sandbox Permission Report

Status: completed.

## Delivered
- WorktreeManager and workspace lease types under `src/core/workspace/`.
- PathPolicy, CommandPolicy, SandboxPolicy, SandboxRuntime, and violation types under `src/core/sandbox/`.
- Permission profiles, engine, audit records, approval policies, and invariants under `src/core/permissions-v2/`.

## Validation
- `npm run worktree:smoke`
- `npm run sandbox:policy-smoke`
- `npm run permission:profile-smoke`
- `npm run path-policy:smoke`
- `npm run command-policy:smoke`

## Limits
- The worktree fallback copies UTF-8 text files for deterministic smokes. Large binary-safe copy support is a later hardening task.
