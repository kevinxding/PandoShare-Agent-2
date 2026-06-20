#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

if (!args.prompt) {
  throw new Error('A prompt is required. Pass --prompt <text> or a positional prompt.')
}

const root = process.cwd()
const configPath = resolve(root, args.config ?? 'pandoshare.config.json')
const configText = await readOptionalFile(configPath)
const { parseProjectConfig } = await import('../dist/src/services/config/index.js').catch(() => {
  throw new Error('Compiled services are missing. Run `npm run build` first.')
})
const { runAgentTurn } = await import('../dist/src/services/agent/index.js')

const config = configText === undefined ? {} : parseProjectConfig(configText, configPath)
applyModelOverrides(config, args)

const result = await runAgentTurn({
  config,
  prompt: args.prompt,
  system: args.system,
  maxTokens: args.maxTokens,
  temperature: args.temperature,
})

if (args.json) {
  console.log(
    JSON.stringify(
      {
        provider: result.provider,
        model: result.model,
        text: result.finalText,
        usage: result.usage,
      },
      null,
      2,
    ),
  )
} else {
  printResult(result)
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    help: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case 'agent':
      case 'turn':
        break
      case '--json':
        parsed.json = true
        break
      case '--help':
      case '-h':
        parsed.help = true
        break
      case '--config':
        parsed.config = requiredValue(argv, (index += 1), arg)
        break
      case '--provider':
        parsed.provider = requiredValue(argv, (index += 1), arg)
        break
      case '--model':
        parsed.model = requiredValue(argv, (index += 1), arg)
        break
      case '--system':
        parsed.system = requiredValue(argv, (index += 1), arg)
        break
      case '--prompt':
        parsed.prompt = requiredValue(argv, (index += 1), arg)
        break
      case '--max-tokens':
        parsed.maxTokens = parsePositiveInt(requiredValue(argv, (index += 1), arg), arg)
        break
      case '--temperature':
        parsed.temperature = parseNumber(requiredValue(argv, (index += 1), arg), arg)
        break
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`)
        positional.push(arg)
        break
    }
  }

  if (!parsed.prompt && positional.length) {
    parsed.prompt = positional.join(' ')
  }

  return parsed
}

function applyModelOverrides(config, args) {
  if (!args.provider && !args.model) return
  config.model = {
    ...(config.model ?? {}),
    provider: args.provider ?? config.model?.provider,
    name: args.model ?? config.model?.name,
  }
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function parseNumber(value, flag) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a number`)
  return parsed
}

async function readOptionalFile(path) {
  try {
    await access(path)
  } catch {
    return undefined
  }
  return readFile(path, 'utf8')
}

function printResult(result) {
  console.log(`provider: ${result.provider}`)
  console.log(`model: ${result.model}`)
  console.log('text:')
  console.log(result.finalText)
  if (result.usage !== undefined) {
    console.log(`usage: ${JSON.stringify(result.usage)}`)
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/agent-turn.mjs [agent turn] [options] [prompt]

Options:
  --config <path>        Config file path. Default: pandoshare.config.json.
  --provider <id>        Override model.provider.
  --model <name>         Override model.name.
  --system <text>        Set a system instruction for this run.
  --prompt <text>        Prompt text. Positional prompt is also accepted.
  --max-tokens <number>  Override max output tokens.
  --temperature <number> Override sampling temperature.
  --json                 Print compact JSON.
  --help                 Show this help.
`)
}
