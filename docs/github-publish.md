# GitHub Publish Checklist

Use this checklist before uploading the project to GitHub.

## What To Commit

- Source code: `src/`, `bin/`, `scripts/`, `web/src/`, `docs/`, `tools/`, `types/`, `utils/`, `vendor/README.md`.
- Project metadata: `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `AGENTS.md`.
- Safe sample config: `pandoshare.config.example.json`.

## What Not To Commit

- Local runtime state: `.pandoshare/`.
- Dependencies and build output: `node_modules/`, `dist/`, `build-src/`.
- Temporary workspaces: `.tmp-*/`, `tmp/`, `temp/`.
- Local secrets and machine config: `.env`, `.env.*`, `pandoshare.config.json`, private keys, logs.

## Local Setup After Clone

```bash
npm install
copy pandoshare.config.example.json pandoshare.config.json
npm run typecheck
npm run check
```

Set API keys through environment variables only:

```bash
set OPENAI_API_KEY=...
set DEEPSEEK_API_KEY=...
set MINIMAX_CN_API_KEY=...
set PANDO_GATEWAY_PAIRING_SECRET=...
```

## Publish Commands

```bash
git init
git add .
git status --short
git commit -m "Initial Pando agent platform"
git branch -M main
git remote add origin https://github.com/<your-name>/<your-repo>.git
git push -u origin main
```

Before `git commit`, inspect `git status --short` carefully. If `.pandoshare`,
`node_modules`, `dist`, `.env`, or `pandoshare.config.json` appears, stop and fix
ignore rules before committing.

## Suggested Private First

Create the GitHub repository as private first. After ChatGPT reviews the code,
you can decide whether to make it public and add a formal license/NOTICE plan.
