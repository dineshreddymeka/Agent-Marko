import { mkdir, appendFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config'
import { isDebugChannel, logger, redact } from '../log'

const log = logger.child({ component: 'llm-debug' })
const MAX_DUMPS = 20

/**
 * DEBUG_LLM rotating dumps under HERMES_DATA_DIR/logs.
 * Author: Dinesh Reddy Meka
 */
export async function dumpLlmDebug(label: string, payload: unknown): Promise<void> {
  if (!isDebugChannel('llm') && !config.DEBUG_LLM) return
  try {
    const dir = join(config.HERMES_DATA_DIR, 'logs')
    await mkdir(dir, { recursive: true })
    const body = isDebugChannel('llmFull') ? payload : { summary: true, label, keys: Object.keys((payload as object) ?? {}) }
    const file = join(dir, `llm-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
    await appendFile(
      file,
      JSON.stringify({
        ts: new Date().toISOString(),
        label,
        payload: redact(isDebugChannel('llmFull') ? payload : body),
      }) + '\n',
      'utf8',
    )
    const files = (await readdir(dir))
      .filter((f) => f.startsWith('llm-') && f.endsWith('.jsonl'))
      .sort()
    while (files.length > MAX_DUMPS) {
      const oldest = files.shift()
      if (oldest) await unlink(join(dir, oldest)).catch(() => undefined)
    }
  } catch (err) {
    log.warn('LLM debug dump failed', { error: err })
  }
}
