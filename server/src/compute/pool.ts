import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config'

const log = logger.child({ component: 'compute' })

export type ComputeTask =
  | { type: 'echo'; payload: unknown }
  | { type: 'hash'; payload: string }
  | { type: 'json_parse'; payload: string }

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const poolSize = () => Math.max(1, config.COMPUTE_POOL_SIZE || 2)
const workers: Worker[] = []
const pending = new Map<string, Pending>()
let rr = 0

function ensureWorkers(): void {
  if (workers.length > 0) return
  const n = poolSize()
  for (let i = 0; i < n; i++) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url).href, {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id?: string; ok?: boolean; result?: unknown; error?: string }
      if (!data?.id) return
      const entry = pending.get(data.id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(data.id)
      if (data.ok) entry.resolve(data.result)
      else entry.reject(new Error(data.error ?? 'Worker task failed'))
    }
    worker.onerror = (err) => {
      log.warn('Compute worker error', { error: err })
    }
    workers.push(worker)
  }
  log.info('Compute worker pool ready', { size: workers.length })
}

export async function runComputeTask(task: ComputeTask, timeoutMs = 30_000): Promise<unknown> {
  ensureWorkers()
  const id = randomUUID()
  const worker = workers[rr++ % workers.length]!
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Compute task timed out'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ id, ...task })
  })
}

export async function runCodeInSandbox(code: string, signal?: AbortSignal): Promise<unknown> {
  const scriptPath = join(config.HERMES_DATA_DIR, 'sandbox', `${randomUUID()}.ts`)
  await mkdir(join(config.HERMES_DATA_DIR, 'sandbox'), { recursive: true })
  const wrapped = `
const __result = (async () => {
${code}
})();
console.log(JSON.stringify(await __result));
`
  await writeFile(scriptPath, wrapped, 'utf8')

  try {
    const bunBin = process.execPath.includes('bun') ? process.execPath : 'bun'
    const timeoutMs = config.RUN_CODE_TIMEOUT_MS || 30_000
    const proc = Bun.spawn([bunBin, 'run', scriptPath], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NO_NETWORK: '1',
        BUN_JSC_forceRAMSize: String(256 * 1024 * 1024),
      },
      signal,
    })
    const timeout = setTimeout(() => proc.kill(), timeoutMs)
    const onAbort = () => proc.kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      clearTimeout(timeout)
      if (exitCode !== 0) {
        return { error: stderr || `Exit code ${exitCode}` }
      }
      try {
        return JSON.parse(stdout.trim())
      } catch {
        return { output: stdout.trim() }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timeout)
    }
  } finally {
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(scriptPath)
    } catch {
      // ignore cleanup errors
    }
  }
}

export function getComputePoolStatus() {
  ensureWorkers()
  return {
    workers: workers.length,
    pending: pending.size,
    status: 'ready' as const,
  }
}
