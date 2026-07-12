import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config'

const poolSize = 2
const workers: Worker[] = []

function ensureWorkers(): void {
  if (workers.length > 0) return
  for (let i = 0; i < poolSize; i++) {
    workers.push(
      new Worker(new URL('./worker.ts', import.meta.url).href, {
        type: 'module',
      }),
    )
  }
}

export async function runCodeInSandbox(code: string, signal?: AbortSignal): Promise<unknown> {
  const scriptPath = join(config.HERMES_DATA_DIR, 'sandbox', `${randomUUID()}.ts`)
  const wrapped = `
const __result = (async () => {
${code}
})();
console.log(JSON.stringify(await __result));
`
  await writeFile(scriptPath, wrapped, 'utf8')

  try {
    const proc = Bun.spawn(['bun', 'run', scriptPath], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_NETWORK: '1' },
      signal,
    })
    const timeout = setTimeout(() => proc.kill(), 30_000)
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
    try {
      await unlink(scriptPath)
    } catch {
      // ignore cleanup errors
    }
  }
}

export function getComputePoolStatus() {
  ensureWorkers()
  return { workers: workers.length, status: 'stub' }
}
