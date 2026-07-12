import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { config } from '../config'
import { indexerRepo } from '../db/repositories/indexer'
import { logger } from '../log'
import { isIgnoredPath, isTextFile, normalizeIndexPath } from './ignore'

const log = logger.child({ component: 'indexer-scanner' })

/**
 * Walk WORKSPACE_ROOT and enqueue upsert jobs for text files.
 * Returns the number of jobs queued.
 */
export async function scanWorkspace(): Promise<number> {
  const root = resolve(config.WORKSPACE_ROOT)
  let queued = 0
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const rel = normalizeIndexPath(relative(root, full))
      if (isIgnoredPath(rel)) continue
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && isTextFile(rel)) {
        await indexerRepo.enqueueJob({
          sourceType: 'workspace_file',
          sourceId: rel,
          operation: 'upsert',
          priority: -10,
        })
        queued++
      }
    }
  }
  await walk(root)
  log.info('Workspace scan queued index jobs', { queued, root })
  return queued
}
