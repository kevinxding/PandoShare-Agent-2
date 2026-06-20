#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-doctor-smoke')
const pandoBin = resolve(root, 'bin/pando.js')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const okConfigPath = resolve(smokeRoot, 'ok.config.json')
  await writeFile(okConfigPath, JSON.stringify(configWithAuthNone(), null, 2), 'utf8')
  const okResult = await runNode([pandoBin, 'doctor', '--json', '--config', okConfigPath], smokeRoot)
  const okReport = JSON.parse(okResult.stdout)
  assert(okReport.ok === true, 'doctor should pass with auth none fake config')
  assert(okReport.checks.some(check => check.id === 'thread_store' && check.status === 'passed'), 'doctor should check thread store')

  const missingConfigPath = resolve(smokeRoot, 'missing-auth.config.json')
  await writeFile(missingConfigPath, JSON.stringify(configWithMissingAuth(), null, 2), 'utf8')
  const missingResult = await runNode(
    [pandoBin, 'doctor', '--json', '--config', missingConfigPath],
    smokeRoot,
    { PANDO_DOCTOR_MISSING_KEY: undefined },
  )
  const missingReport = JSON.parse(missingResult.stdout)
  const authCheck = missingReport.checks.find(check => check.id === 'model_auth')
  assert(missingReport.ok === false, 'doctor should fail when auth env is missing')
  assert(authCheck?.status === 'failed', 'model auth check should fail')
  assert(authCheck.message.includes('PANDO_DOCTOR_MISSING_KEY'), 'auth failure should name missing env')

  console.log('doctor smoke passed')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

function configWithAuthNone() {
  return {
    model: {
      provider: 'fake-openai-compatible',
      name: 'fake-model',
    },
    providers: {
      'fake-openai-compatible': {
        baseURL: 'https://example.invalid/v1',
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'none',
        },
      },
    },
  }
}

function configWithMissingAuth() {
  return {
    model: {
      provider: 'fake-missing-auth',
      name: 'fake-model',
    },
    providers: {
      'fake-missing-auth': {
        baseURL: 'https://example.invalid/v1',
        model: 'fake-model',
        protocol: 'openai-chat-completions',
        auth: {
          type: 'api-key',
          envKeys: ['PANDO_DOCTOR_MISSING_KEY'],
        },
      },
    },
  }
}

function runNode(args, cwd, envPatch = {}) {
  return new Promise((resolveRun, reject) => {
    const env = { ...process.env, ...envPatch }
    for (const [key, value] of Object.entries(envPatch)) {
      if (value === undefined) delete env[key]
    }
    const child = spawn(process.execPath, args, {
      cwd,
      env,
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
