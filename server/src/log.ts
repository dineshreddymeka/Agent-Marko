import { config } from './config'

export type LogContext = {
  threadId?: string
  runId?: string
  userId?: string
  toolCallId?: string
  [key: string]: unknown
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[config.LOG_LEVEL]
}

function write(level: LogLevel, message: string, ctx?: LogContext): void {
  if (!shouldLog(level)) return
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...ctx,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => write('debug', message, ctx),
  info: (message: string, ctx?: LogContext) => write('info', message, ctx),
  warn: (message: string, ctx?: LogContext) => write('warn', message, ctx),
  error: (message: string, ctx?: LogContext) => write('error', message, ctx),
  child: (ctx: LogContext) => ({
    debug: (message: string, extra?: LogContext) => write('debug', message, { ...ctx, ...extra }),
    info: (message: string, extra?: LogContext) => write('info', message, { ...ctx, ...extra }),
    warn: (message: string, extra?: LogContext) => write('warn', message, { ...ctx, ...extra }),
    error: (message: string, extra?: LogContext) => write('error', message, { ...ctx, ...extra }),
    child: (extra: LogContext) => logger.child({ ...ctx, ...extra }),
  }),
}
