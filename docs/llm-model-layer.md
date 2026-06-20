# LLM Model Layer

This module is the first provider/model abstraction for the Pandoshare agent runtime.
It borrows the OpenCode separation of provider, model, route/protocol, and request
preparation without vendoring OpenCode's runtime.

## Providers

- `openai`: OpenAI API, `https://api.openai.com/v1`, Responses API, `OPENAI_API_KEY`.
- `openai-codex`: ChatGPT/Codex login token path, `https://chatgpt.com/backend-api/codex`, Responses API, `CODEX_ACCESS_TOKEN`.
- `deepseek`: DeepSeek OpenAI-compatible API, `https://api.deepseek.com`, Chat Completions, `DEEPSEEK_API_KEY`.
- `minimax-cn`: MiniMax China Token Plan, `https://api.minimaxi.com/v1`, Chat Completions, `MINIMAX_CN_API_KEY` or `MINIMAX_API_KEY`.
- `custom`: caller-provided OpenAI-compatible base URL, model, and API key env.

## Secret Handling

Do not commit real API keys. Use local environment variables or ignored `.env.local`
files. The repository `.gitignore` already excludes `.env` and `.env.*`.

Recommended local names:

```powershell
$env:DEEPSEEK_API_KEY = "..."
$env:MINIMAX_CN_API_KEY = "..."
$env:OPENAI_API_KEY = "..."
$env:CODEX_ACCESS_TOKEN = "..."
```

`openai-codex` is not the same as a normal OpenAI API key. It is for the Codex
ChatGPT-login token path. The first version reads `CODEX_ACCESS_TOKEN` and optional
`CODEX_CHATGPT_ACCOUNT_ID` / `CHATGPT_ACCOUNT_ID`; it does not read or copy
`~/.codex/auth.json`.

## Offline Demo

Use `createOfflineDemoPreparedRequests()` to inspect provider URLs, protocols,
request bodies, and redacted headers without requiring keys.

The command-line smoke test defaults to offline mode:

```powershell
npm run model:test
```

Override provider/model without editing config:

```powershell
npm run model:test -- --provider deepseek --model deepseek-v4-flash
```

## Project Config

The first config format is JSON only:

```json
{
  "model": {
    "provider": "minimax-cn",
    "name": "MiniMax-M3"
  }
}
```

Custom OpenAI-compatible providers can be configured without storing secrets:

```json
{
  "model": {
    "provider": "my-local-model",
    "name": "local-model"
  },
  "providers": {
    "my-local-model": {
      "baseURL": "http://127.0.0.1:1234/v1",
      "model": "local-model",
      "protocol": "openai-chat-completions",
      "apiKeyEnv": "LOCAL_LLM_API_KEY"
    }
  }
}
```

`apiKeyEnv` stores the environment variable name, not the key value.

## Online Call

Use `generateText()` when the relevant key is available in the environment.
The first version supports non-streaming text calls. Streaming and tool-call
continuation are planned for the agent loop layer.

Run a real smoke call only when the selected provider key is available:

```powershell
npm run model:test:online
```

Online smoke sends a short prompt and may consume provider credits.
