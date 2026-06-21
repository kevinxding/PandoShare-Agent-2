# Tool Runtime V2

## Scope
ToolRuntime V2 is the auditable execution layer for file, shell, patch, and GUI-delegated actions.

## Interfaces
- Source: `src/core/tool/index.ts`
- Main class: `ToolRuntime`
- Request type: `ToolRuntimeRequest`
- Result type: `ToolExecutionRecord`

## Current guarantees
- Tool calls are classified by side effect risk.
- Approval policy supports ask, trusted, and never modes.
- Completed tool calls persist a result reference under the workspace/result root.
- File changes include before/after hash snapshots.
- GUI calls are delegated through GuiRuntime instead of exposing low-level GUI backends directly.

## Validation
- `npm run tool-runtime:smoke`
- `npm run patch-verifier:smoke`
