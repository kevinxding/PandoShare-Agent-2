# Code Agent Harness

## Scope
The CodeAgent harness provides deterministic offline fixtures for validating code-editing behavior before a real model loop is attached.

## Interfaces
- Source: `src/core/code-agent/index.ts`
- Main class: `CodeAgentHarness`
- Fixture parser: `parseCodeTaskFixture`
- Verifier: `PatchVerifier`
- Test runner: `TestCommandRunner`

## Current guarantees
- Creates an isolated temporary workspace per fixture run.
- Seeds files from fixture JSON.
- Executes write, patch, and shell operations through ToolRuntime.
- Runs verifier commands and patch/file checks.
- Produces a CodeAgent report object and Markdown renderer.

## Fixtures
- `tests/fixtures/code-agent/simple-ts-bug/fixture.json`
- `tests/fixtures/code-agent/readme-update/fixture.json`
- `tests/fixtures/code-agent/failing-test-fix/fixture.json`

## Validation
- `npm run code-agent:harness-smoke`
- `npm run code-agent:fixture-smoke`
