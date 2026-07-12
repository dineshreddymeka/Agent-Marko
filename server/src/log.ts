/**
 * Open Jarvis structured logger — max-debuggability.
 * Author: Dinesh Reddy Meka
 *
 * Env:
 *   LOG_LEVEL=debug|info|warn|error
 *   LOG_PRETTY=1          human-readable lines (default on when LOG_LEVEL=debug)
 *   LOG_HTTP=1            log every HTTP request/response
 *   DEBUG_LLM=1           LLM stream/request summaries (redacted)
 *   DEBUG_LLM_FULL=1      include message/tool payloads (secrets still redacted)
 *   DEBUG_AGUI=1          AG-UI run lifecycle + event types
 *   DEBUG_DB=1            DB ping / query timing
 *   DEBUG_MCP=1           MCP connect/tool bridge
 *   DEBUG_TOOLS=1         tool invoke start/end
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from './config'

export type LogContext = {
  requestId?: string
  threadId?: string
  runId?: string
  userId?: string
  toolCallId?: string
  toolName?: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  eventType?: string
  provider?: string
  error?: unknown
  err?: unknown
  stack?: string
  [key: string]: unknown
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SENSITIVE_KEY =
  /^(authorization|api[_-]?key|apikey|token|secret|password|passwd|access[_-]?token|refresh[_-]?token|cookie|set-cookie|bearer)$/i

const requestStore = new AsyncLocalStorage<LogContext>()

function envFlag(name: string): boolean {
  const v = process.env[name]
  if (v === undefined || v === '') return false
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())
}

export function isDebugChannel(channel: 'llm' | 'llmFull' | 'agui' | 'db' | 'mcp' | 'tools' | 'http'): boolean {
  switch (channel) {
    case 'llm':
      return envFlag('DEBUG_LLM') || config.DEBUG_LLM || config.LOG_LEVEL === 'debug'
    case 'llmFull':
      return envFlag('DEBUG_LLM_FULL')
    case 'agui':
      return envFlag('DEBUG_AGUI') || config.LOG_LEVEL === 'debug'
    case 'db':
      return envFlag('DEBUG_DB') || config.LOG_LEVEL === 'debug'
    case 'mcp':
      return envFlag('DEBUG_MCP') || config.LOG_LEVEL === 'debug'
    case 'tools':
      return envFlag('DEBUG_TOOLS') || config.LOG_LEVEL === 'debug'
    case 'http':
      return envFlag('LOG_HTTP') || envFlag('DEBUG_HTTP') || config.LOG_LEVEL === 'debug'
  }
}

function usePretty(): boolean {
  if (envFlag('LOG_PRETTY')) return true
  if (envFlag('LOG_JSON')) return false
  return config.LOG_LEVEL === 'debug'
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[config.LOG_LEVEL]
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MaxDepth]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (value.length > 2000) return `${value.slice(0, 2000)}…[+${value.length - 2000}]`
    return value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[REDACTED]'
      continue
    }
    out[k] = redact(v, depth + 1)
  }
  return out
}

export function serializeError(err: unknown): { error: string; stack?: string; code?: string } {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; stack?: string; code?: string; name?: string }
    return {
      error: e.message ?? String(err),
      stack: e.stack,
      code: e.code,
    }
  }
  return { error: String(err) }
}

function normalizeCtx(ctx?: LogContext): LogContext {
  const base = { ...requestStore.getStore(), ...ctx }
  const out: LogContext = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue
    if (k === 'error' || k === 'err') {
      const ser = serializeError(v)
      out.error = ser.error
      if (ser.stack) out.stack = ser.stack
      if (ser.code) out.code = ser.code
      continue
    }
    out[k] = redact(v) as unknown
  }
  return out
}

function formatPretty(level: LogLevel, message: string, ctx: LogContext): string {
  const ids = [
    ctx.requestId ? `req=${ctx.requestId}` : null,
    ctx.threadId ? `thread=${ctx.threadId}` : null,
    ctx.runId ? `run=${ctx.runId}` : null,
    ctx.toolCallId ? `tool=${ctx.toolCallId}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  const skip = new Set(['requestId', 'threadId', 'runId', 'toolCallId'])
  const extras = Object.entries(ctx)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  const prefix = ids ? ` ${ids}` : ''
  const suffix = extras ? ` | ${extras}` : ''
  return `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${prefix}${suffix}`
}

function write(level: LogLevel, message: string, ctx?: LogContext): void {
  if (!shouldLog(level)) return
  const normalized = normalizeCtx(ctx)
  if (usePretty()) {
    const line = formatPretty(level, message, normalized)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
    return
  }
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    service: 'open-jarvis',
    ...normalized,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export type Logger = {
  debug: (message: string, ctx?: LogContext) => void
  info: (message: string, ctx?: LogContext) => void
  warn: (message: string, ctx?: LogContext) => void
  error: (message: string, ctx?: LogContext) => void
  child: (ctx: LogContext) => Logger
  time: (label: string, ctx?: LogContext) => (extra?: LogContext) => void
}

function createLogger(base: LogContext = {}): Logger {
  return {
    debug: (message, extra) => write('debug', message, { ...base, ...extra }),
    info: (message, extra) => write('info', message, { ...base, ...extra }),
    warn: (message, extra) => write('warn', message, { ...base, ...extra }),
    error: (message, extra) => write('error', message, { ...base, ...extra }),
    child: (extra) => createLogger({ ...base, ...extra }),
    time: (label, ctx) => {
      const start = performance.now()
      write('debug', `${label}:start`, { ...base, ...ctx })
      return (extra) => {
        write('debug', `${label}:end`, {
          ...base,
          ...ctx,
          ...extra,
          durationMs: Math.round(performance.now() - start),
        })
      }
    },
  }
}

export const logger = createLogger()

/** Run fn with request-scoped log context (merged into every log line). */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = requestStore.getStore() ?? {}
  return requestStore.run({ ...parent, ...ctx }, fn)
}

export async function runWithLogContextAsync<T>(ctx: LogContext, fn: () => Promise<T>): Promise<T> {
  const parent = requestStore.getStore() ?? {}
  return requestStore.run({ ...parent, ...ctx }, fn)
}

export function getLogContext(): LogContext | undefined {
  return requestStore.getStore()
}

export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}
