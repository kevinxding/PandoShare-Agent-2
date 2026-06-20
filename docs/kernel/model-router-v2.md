# Model Router V2

## Purpose

Model Router V2 upgrades the previous thin provider selector into the auditable scheduling kernel for model choice. It chooses a provider/model from task, profile, capabilities, health, cost, budget, risk, context size, and fallback needs while keeping the existing `src/services/llm` client as the transport layer.

## Implemented Scope

- Provider catalog from built-in and configured OpenAI-compatible providers.
- Capability graph for tools, vision, streaming, reasoning, long context, JSON mode, function calling style, privacy, region, latency, and cost class.
- Profiles for build, plan, GUI, loop, verifier, repair, gateway, compact, replay, and cheap work.
- Route decisions with selected provider/model, rejected candidates, capability matches, budget decision, health decision, fallback plan, and route reasons.
- Durable model events for route request, route selected/rejected, fallback plan/selection, request start, response completion, request failure, rate limit, budget warning/exceeded, health change, and usage.
- Usage ledger through `ModelUsageStore`, plus `CostTracker` compatibility.
- Health-aware fallback and rate-limit classification from `LLMProviderError`.
- Minimal `ModelExecutionBridge` wrapping `generateText` and `streamText` without replacing the LLM client.
- Gateway `/model` command matrix: status, list, route, set, health, usage, and budget.
- Replay `Model Timeline` section.
- Backward-compatible synchronous `selectModel()` for older callers and smoke tests.

## Non-Goals

- No AI SDK, Models.dev, Redis, database, or external catalog service.
- No new provider transport protocol beyond the existing OpenAI-compatible client.
- No Web UI model picker in this phase.
- No online benchmark runner or real provider health probing in this phase.
- No automatic price table updates.
- No multi-tenant billing enforcement.

## Safety Rules

- Model events must not store API keys, access tokens, raw auth headers, or provider secrets.
- Durable events store provider/model ids, capability summaries, route reasons, budget status, and usage numbers only.
- Missing auth is visible in catalog/route reasoning, but remains non-fatal by default for offline diagnostics and existing smoke compatibility. Policies may make it a hard rejection with `healthPolicy.allowMissingAuth: false`.
- Verifier profile avoids the source provider family when alternatives exist.

## Public Interfaces

- `ModelRouter.fromConfig(config, options)`
- `router.route(request)` for audited async decisions.
- `router.explainRoute(request)` for sync dry-run decisions.
- `router.selectModel(request)` for legacy sync compatibility.
- `router.planFallback(decision, reason)`
- `router.recordRequestStarted(decision)`
- `router.recordResponseCompleted(decision, usage)`
- `router.recordRequestFailed(decision, error)`
- `router.readUsage(filter)` and `router.readBudgetStatus(filter)`
- `router.listProviders()`, `router.listModels()`, `router.listProfiles()`, `router.readHealth()`

## Smoke Coverage

- `npm run model:router-smoke`
- `npm run model:capability-smoke`
- `npm run model:fallback-smoke`
- `npm run model:budget-smoke`
- `npm run model:profile-smoke`

## Remaining Work

- Real provider probes and periodic health refresh.
- User-facing Web UI model picker and profile editor.
- Provider-specific tokenizer and price table.
- Latency/cost benchmark history.
- Multi-tenant budget scopes and monthly accounting.
- Deeper loop integration for automatic per-task profile switching.