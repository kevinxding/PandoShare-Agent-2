const VERSION = '0.1.0'

type RuntimeProcess = {
  argv: string[]
  stdout: {
    write(text: string): void
  }
  stderr?: {
    write(text: string): void
  }
  exitCode?: number
}

function getRuntimeProcess(): RuntimeProcess {
  const runtime = globalThis as unknown as { process?: RuntimeProcess }
  if (!runtime.process) {
    throw new Error('process runtime is unavailable')
  }
  return runtime.process
}

async function cli(): Promise<void> {
  const runtimeProcess = getRuntimeProcess()
  const argv = runtimeProcess.argv.slice(2)
  if (argv.length === 1 && ['--version', '-v', '-V'].includes(argv[0] ?? '')) {
    runtimeProcess.stdout.write(`${VERSION} (Pando)\n`)
    return
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    runtimeProcess.stdout.write(formatHelp())
    if (argv.length === 1) return
  }

  const { main } = await import('../main.js')
  await main(argv)
}

function formatHelp(): string {
  return [
    'Pando Agent',
    '',
    'Usage:',
    '  pando',
    '  pando "prompt"',
    '  pando exec "prompt"',
    '  pando doctor [--json]',
    '  pando mcp doctor|list [--json]',
    '  pando gui doctor [--json]',
    '  pando gateway doctor|status|start|recover|stop [--json]',
    '  pando serve [--host <host>] [--port <number>] [--open]',
    '  pando goal create|list|inspect|status|resume|pause|block|complete|export',
    '  pando thread list|inspect|rename|export|branch|compact',
    '  pando loop create|list|run|inspect|pause|resume|stop|export',
    '',
    'Options:',
    '  --config <path>   Use a config file instead of pandoshare.config.json.',
    '  --provider <id>    Override model.provider for pando prompt/exec/repl.',
    '  --model <name>     Override model.name for pando prompt/exec/repl.',
    '  --thread <id>     Continue a thread.',
    '  --resume-last     Continue the most recently updated thread.',
    '  --new-thread      Force a new thread.',
    '  --goal <id>       Link a prompt, thread, or loop run to a Pando goal.',
    '  --max-tokens <n>  Limit loop token use when creating a loop.',
    '  --manual-intervention-after-failures <n>  Block a loop for human review after repeated failures.',
    '  --manual-intervention-pattern <text>      Block a loop when verifier feedback contains text.',
    '  --progress-heartbeat-interval-ms <ms>  Override gateway progress heartbeat interval.',
    '  --wake-heartbeat-interval-ms <ms>      Override gateway wake heartbeat interval.',
    '  --version         Print version.',
    '  --help            Show help.',
    '',
  ].join('\n')
}

try {
  await cli()
} catch (error) {
  const runtimeProcess = getRuntimeProcess()
  const message = error instanceof Error ? error.message : String(error)
  ;(runtimeProcess.stderr ?? runtimeProcess.stdout).write(`Error: ${message}\n`)
  runtimeProcess.exitCode = 1
}

export {}
