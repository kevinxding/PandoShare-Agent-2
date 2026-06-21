# Context, Memory, And Compaction V2

## Scope
Context V2 builds auditable model context packs. Memory stores redacted local records. Compaction verifies tool-call pairing before accepting a summary.

## Interfaces
- Context: `src/core/context/index.ts`
- Memory: `src/core/memory/index.ts`
- Compaction: `src/core/compaction/index.ts`

## Current guarantees
- Context fragments carry provenance and priority.
- Protected identity/system fragments survive budget pressure.
- Evidence and memory summaries redact obvious API key/token/secret patterns.
- Compaction refuses transcripts where assistant tool calls are missing matching tool results.

## Validation
- `npm run context:runtime-smoke`
- `npm run context:evidence-smoke`
- `npm run memory:smoke`
- `npm run compaction:runtime-smoke`
- `npm run context:budget-smoke`
