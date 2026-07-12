/**
 * Open Jarvis — per-run cron workflow bindings.
 * Author: Dinesh Reddy Meka
 *
 * The scheduler runs each cron-fired agent turn inside an AsyncLocalStorage
 * scope carrying the job's workflow bindings. Downstream code (tool registry,
 * context builder, approval gate) reads the scope without threading extra
 * parameters through the shared agent runtime — keeping runtime.ts untouched.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type CronRunBindings = {
  jobId: string
  jobName: string
  /** MCP server allowlist for this run. Empty array = NO MCP tools (not "all"). */
  mcpServerIds: string[]
  /** Skill ids force-injected into context (bypasses similarity-only matching). */
  skillIds: string[]
  /** Bypass the approval gate for this headless run only. */
  headlessAutoApprove: boolean
}

const storage = new AsyncLocalStorage<CronRunBindings>()

export function runWithCronBindings<T>(bindings: CronRunBindings, fn: () => Promise<T>): Promise<T> {
  return storage.run(bindings, fn)
}

/** Returns bindings when executing inside a cron-fired run, else undefined. */
export function getCronBindings(): CronRunBindings | undefined {
  return storage.getStore()
}
