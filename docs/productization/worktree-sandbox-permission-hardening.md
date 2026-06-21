# Worktree, Sandbox, And Permission Hardening

## Scope
This layer gives long-running agents a safer execution boundary before real autonomous code or GUI runs are delegated.

## Interfaces
- Workspaces: `src/core/workspace/index.ts`
- Sandbox: `src/core/sandbox/index.ts`
- Permissions: `src/core/permissions-v2/index.ts`

## Current guarantees
- WorktreeManager can acquire an isolated temp copy and clean it up.
- PathPolicy distinguishes read, write, delete, move, and copy operations.
- CommandPolicy blocks high-risk destructive patterns and asks for remote mutations.
- PermissionEngine combines named profiles with sandbox decisions and audit records.

## Validation
- `npm run worktree:smoke`
- `npm run sandbox:policy-smoke`
- `npm run permission:profile-smoke`
- `npm run path-policy:smoke`
- `npm run command-policy:smoke`
