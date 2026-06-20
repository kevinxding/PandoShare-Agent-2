#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-cli-entry-smoke')
const pandoBin = resolve(root, 'bin/pando.js')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

let server
try {
  const version = await runNode([pandoBin, '--version'], root)
  assert(version.stdout.includes('0.1.0 (Pando)'), 'version output should include Pando version')

  const help = await runNode([pandoBin, '--help'], root)
  assert(help.stdout.includes('pando exec "prompt"'), 'help should include exec usage')
  assert(help.stdout.includes('pando doctor [--json]'), 'help should include doctor usage')
  assert(help.stdout.includes('pando serve [--host <host>] [--port <number>] [--open]'), 'help should include serve host usage')
  assert(help.stdout.includes('--provider <id>'), 'help should include provider override')
  assert(help.stdout.includes('--model <name>'), 'help should include model override')

  server = await startFakeLlmServer()
  const configPath = resolve(smokeRoot, 'pandoshare.config.json')
  await writeFile(configPath, JSON.stringify(fakeConfig(server.url), null, 2), 'utf8')
  const execResult = await runNode([
    pandoBin,
    'exec',
    '--config',
    configPath,
    '--provider',
    'cli-override-provider',
    '--model',
    'cli-override-model',
    'hello from cli',
  ], smokeRoot)
  assert(execResult.stdout.includes('cli entry ok'), `exec output should include model response: ${execResult.stdout}`)
  assert(server.requests.length === 1, 'override provider server should receive exactly one request')
  assert(server.requests[0]?.model === 'cli-override-model', `CLI model override should reach LLM request: ${server.requests[0]?.model}`)

  console.log('cli entry smoke passed')
} finally {
  await closeServer(server)
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function fakeConfig(baseURL) {
  return {
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    providers: {
      'fake-openai-compatible': {
        baseURL: 'http://127.0.0.1:9/v1',
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
      'cli-override-provider': {
        baseURL,
        model: 'wrong-default-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
    },
    permissions: {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    },
  }
}

function startFakeLlmServer() {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      requests.push(parsed)
      assert(parsed.messages?.some(message => message.content === 'hello from cli'), 'LLM request should include CLI prompt')
      assert(parsed.model === 'cli-override-model', `LLM request should use CLI model override, got ${parsed.model}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'cli entry ok',
            },
          },
        ],
      }))
    })
  })
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolveServer({
        url: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () => new Promise(resolveClose => server.close(resolveClose)),
      })
    })
  })
}

async function closeServer(server) {
  if (server) await server.close()
}

function runNode(args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`node ${args.join(' ')} failed with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        return
      }
      resolveRun({ stdout, stderr })
    })
  })
}

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
