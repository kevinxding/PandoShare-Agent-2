declare module 'node:fs/promises' {
  export type FileHandle = unknown
  export function readFile(path: string, encoding: 'utf8'): Promise<string>
  export function writeFile(path: string, data: string, encoding?: 'utf8'): Promise<void>
  export function appendFile(path: string, data: string, encoding?: 'utf8'): Promise<void>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function readdir(path: string, options?: { withFileTypes?: false }): Promise<string[]>
  export function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number }>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

declare module 'node:http' {
  export type IncomingMessage = {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>
    on(event: 'data', listener: (chunk: unknown) => void): void
    on(event: 'end', listener: () => void): void
    on(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: () => void): void
  }

  export type ServerResponse = {
    statusCode: number
    setHeader(name: string, value: string | number | readonly string[]): void
    writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): void
    write(chunk: string): void
    end(chunk?: string): void
  }

  export type Server = {
    listen(port: number, host: string, callback?: () => void): void
    address(): { port: number; address: string } | string | null
    close(callback?: (error?: Error) => void): void
  }

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  ): Server
}

declare module 'node:path' {
  export const sep: string
  export function basename(path: string): string
  export function dirname(path: string): string
  export function extname(path: string): string
  export function isAbsolute(path: string): boolean
  export function join(...paths: string[]): string
  export function normalize(path: string): string
  export function relative(from: string, to: string): string
  export function resolve(...paths: string[]): string
}

declare module 'node:child_process' {
  export type SpawnOptions = {
    cwd?: string
    env?: Record<string, string | undefined>
    windowsHide?: boolean
  }

  export type ChildProcess = {
    pid?: number
    stdout?: {
      on(event: 'data', listener: (chunk: unknown) => void): void
    }
    stderr?: {
      on(event: 'data', listener: (chunk: unknown) => void): void
    }
    on(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: (code: number | null, signal: string | null) => void): void
    kill(signal?: string): boolean
  }

  export function spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess
}

declare module 'node:os' {
  export function platform(): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}

declare module 'node:vm' {
  export type Context = unknown

  export function createContext(contextObject?: Record<string, unknown>): Context

  export class Script {
    constructor(code: string, options?: { filename?: string })
    runInContext(context: Context, options?: { timeout?: number }): unknown
  }
}

declare module 'node:readline/promises' {
  export type Interface = {
    question(query: string): Promise<string>
    close(): void
  }

  export function createInterface(options: { input: unknown; output: unknown }): Interface
}
