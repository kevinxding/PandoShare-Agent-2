#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const rootDirs = [
  'docs',
  'scripts',
  'src',
  'stubs',
  'tools',
  'types',
  'utils',
  'vendor',
]

const srcDirs = [
  'assistant',
  'bootstrap',
  'bridge',
  'buddy',
  'cli',
  'commands',
  'components',
  'constants',
  'context',
  'coordinator',
  'entrypoints',
  'hooks',
  'ink',
  'keybindings',
  'memdir',
  'migrations',
  'moreright',
  'native-ts',
  'outputStyles',
  'plugins',
  'query',
  'remote',
  'schemas',
  'screens',
  'server',
  'services',
  'skills',
  'state',
  'tasks',
  'tools',
  'types',
  'upstreamproxy',
  'utils',
  'vim',
  'voice',
]

const serviceDirs = [
  'AgentSummary',
  'analytics',
  'api',
  'autoDream',
  'compact',
  'extractMemories',
  'gui',
  'lsp',
  'MagicDocs',
  'mcp',
  'oauth',
  'plugins',
  'policyLimits',
  'PromptSuggestion',
  'remoteManagedSettings',
  'SessionMemory',
  'settingsSync',
  'teamMemorySync',
  'tips',
  'tools',
  'toolUseSummary',
]

const toolDirs = [
  'AgentTool',
  'AskUserQuestionTool',
  'BashTool',
  'BriefTool',
  'ConfigTool',
  'EnterPlanModeTool',
  'EnterWorktreeTool',
  'ExitPlanModeTool',
  'ExitWorktreeTool',
  'FileEditTool',
  'FileReadTool',
  'FileWriteTool',
  'GlobTool',
  'GrepTool',
  'GuiTool',
  'ListMcpResourcesTool',
  'LSPTool',
  'McpAuthTool',
  'MCPTool',
  'NotebookEditTool',
  'PowerShellTool',
  'ReadMcpResourceTool',
  'RemoteTriggerTool',
  'REPLTool',
  'ScheduleCronTool',
  'SendMessageTool',
  'SkillTool',
  'SleepTool',
  'SyntheticOutputTool',
  'TaskCreateTool',
  'TaskGetTool',
  'TaskListTool',
  'TaskOutputTool',
  'TaskStopTool',
  'TaskUpdateTool',
  'TeamCreateTool',
  'TeamDeleteTool',
  'TodoWriteTool',
  'ToolSearchTool',
  'WebFetchTool',
  'WebSearchTool',
  'shared',
  'testing',
]

const rootToolDirs = [
  'OverflowTestTool',
  'TerminalCaptureTool',
  'TungstenTool',
  'VerifyPlanExecutionTool',
  'WorkflowTool',
]

const topLevelSrcFiles = [
  'commands.ts',
  'context.ts',
  'costHook.ts',
  'cost-tracker.ts',
  'dialogLaunchers.tsx',
  'history.ts',
  'ink.ts',
  'interactiveHelpers.tsx',
  'main.tsx',
  'projectOnboardingState.ts',
  'query.ts',
  'QueryEngine.ts',
  'replLauncher.tsx',
  'setup.ts',
  'Task.ts',
  'tasks.ts',
  'Tool.ts',
  'tools.ts',
]

const serviceToolFiles = [
  'StreamingToolExecutor.ts',
  'toolExecution.ts',
  'toolHooks.ts',
  'toolOrchestration.ts',
]

const serviceMcpFiles = [
  'auth.ts',
  'channelAllowlist.ts',
  'channelNotification.ts',
  'channelPermissions.ts',
  'client.ts',
  'config.ts',
  'MCPConnectionManager.ts',
  'normalization.ts',
  'types.ts',
  'utils.ts',
]

const entrypointFiles = [
  'agentSdkTypes.ts',
  'cli.tsx',
  'init.ts',
  'mcp.ts',
  'sandboxTypes.ts',
  'sdk/index.ts',
]

async function ensureDir(relativePath) {
  await mkdir(join(root, relativePath), { recursive: true })
}

async function writeOnce(relativePath, content) {
  const path = join(root, relativePath)
  if (existsSync(path)) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return true
}

function modulePlaceholder(name, responsibility) {
  return [
    `// Skeleton module: ${name}`,
    `// Responsibility: ${responsibility}.`,
    '',
    'export {}',
    '',
  ].join('\n')
}

let created = 0

for (const dir of rootDirs) await ensureDir(dir)
for (const dir of srcDirs) {
  await ensureDir(`src/${dir}`)
  if (await writeOnce(`src/${dir}/index.ts`, modulePlaceholder(`src/${dir}`, 'mirrored top-level subsystem boundary'))) created++
}
for (const dir of serviceDirs) {
  await ensureDir(`src/services/${dir}`)
  if (await writeOnce(`src/services/${dir}/index.ts`, modulePlaceholder(`src/services/${dir}`, 'mirrored service subsystem boundary'))) created++
}
for (const dir of toolDirs) {
  await ensureDir(`src/tools/${dir}`)
  if (await writeOnce(`src/tools/${dir}/index.ts`, modulePlaceholder(`src/tools/${dir}`, 'tool module boundary'))) created++
}
for (const dir of rootToolDirs) {
  await ensureDir(`tools/${dir}`)
  if (await writeOnce(`tools/${dir}/README.md`, `# ${dir}\n\nRoot-level tool workspace placeholder.\n`)) created++
}
for (const file of topLevelSrcFiles) {
  if (await writeOnce(`src/${file}`, modulePlaceholder(`src/${file}`, 'mirrored root source module'))) created++
}
for (const file of serviceToolFiles) {
  if (await writeOnce(`src/services/tools/${file}`, modulePlaceholder(`src/services/tools/${file}`, 'tool runtime execution layer'))) created++
}
for (const file of serviceMcpFiles) {
  if (await writeOnce(`src/services/mcp/${file}`, modulePlaceholder(`src/services/mcp/${file}`, 'MCP service layer'))) created++
}
for (const file of entrypointFiles) {
  if (await writeOnce(`src/entrypoints/${file}`, modulePlaceholder(`src/entrypoints/${file}`, 'runtime entrypoint layer'))) created++
}

const extraFiles = {
  'stubs/bun-bundle.ts': "export function feature(_name: string): boolean {\n  return false\n}\n",
  'stubs/macros.ts': "export const MACRO = {\n  VERSION: '0.1.0',\n  PACKAGE_URL: 'pandoshare-agent',\n} as const\n",
  'types/index.d.ts': 'export {}\n',
  'utils/README.md': '# Utils\n\nRepository-level utility workspace placeholder.\n',
  'vendor/README.md': '# Vendor\n\nVendor/native-source placeholder. Keep this empty unless a dependency must be vendored.\n',
}

for (const [file, content] of Object.entries(extraFiles)) {
  if (await writeOnce(file, content)) created++
}

console.log(`Architecture skeleton ready. Created ${created} new files.`)

