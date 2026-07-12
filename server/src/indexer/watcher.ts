import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { config } from '../config'
import { logger } from '../log'
import { drainIndexJobs } from './worker'
import { queueWorkspaceDelete, queueWorkspaceFile } from './service'

const log = logger.child({ component: 'indexer-watcher' })

const DEBOUNCE_MS = 250
const RESTART_MS = 30_000

let watcher: FSWatcher | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
const pending = new Map<string, ReturnType<typeof setTimeout>>()

function workspaceRoot(): string {
  return resolve(config.WORKSPACE_ROOT)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function clearPending(): void {
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
}

async function enqueueObservedPath(rel: string): Promise<void> {
  const normalized = normalizePath(rel)
  if (!normalized || normalized === '.') return
  const full = join(workspaceRoot(), normalized)
  try {
    const info = await stat(full)
    if (info.isFile()) {
      await queueWorkspaceFile(normalized, { priority: 10 })
    }
  } catch {
    await queueWorkspaceDelete(normalized, { priority: 10 })
  }
  void drainIndexJobs().catch((err) => {
    log.warn('Watcher-triggered index drain failed', { error: String(err) })
  })
}

function debouncePath(rel: string): void {
  const normalized = normalizePath(rel)
  const existing = pending.get(normalized)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pending.delete(normalized)
    void enqueueObservedPath(normalized).catch((err) => {
      log.warn('Watcher enqueue failed', { path: normalized, error: String(err) })
    })
  }, DEBOUNCE_MS)
  timer.unref?.()
  pending.set(normalized, timer)
}

function scheduleRestart(): void {
  if (restartTimer) return
  restartTimer = setTimeout(() => {
    restartTimer = null
    startWorkspaceWatcher()
  }, RESTART_MS)
  restartTimer.unref?.()
}

export function startWorkspaceWatcher(): void {
  if (watcher) return
  const root = workspaceRoot()
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      debouncePath(String(filename))
    })
    watcher.on('error', (err) => {
      log.warn('Workspace watcher failed; retrying later', { error: String(err) })
      stopWorkspaceWatcher({ keepRestartTimer: true })
      scheduleRestart()
    })
    watcher.on('close', () => {
      watcher = null
    })
    watcher.unref?.()
    log.info('Workspace watcher started', { root })
  } catch (err) {
    log.warn('Workspace watcher could not start; retrying later', { root, error: String(err) })
    watcher = null
    scheduleRestart()
  }
}

export function stopWorkspaceWatcher(opts?: { keepRestartTimer?: boolean }): void {
  if (watcher) watcher.close()
  watcher = null
  clearPending()
  if (!opts?.keepRestartTimer && restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
}
