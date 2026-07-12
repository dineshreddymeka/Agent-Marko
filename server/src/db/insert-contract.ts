/**
 * Minimal insert-contract helpers — every write should carry a date;
 * session-scoped writes carry session_id (see docs/DATABASE-DESIGN.md).
 */
export function nowTimestamp(): Date {
  return new Date()
}

/** Fields every insert should be able to attach. */
export type InsertContractFields = {
  sessionId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

/**
 * Merge optional session_id + timestamps onto an insert values object.
 * Defaults createdAt/updatedAt to now when `withUpdated` is true.
 */
export function withInsertContract<T extends Record<string, unknown>>(
  values: T,
  opts?: {
    sessionId?: string | null
    withUpdated?: boolean
    now?: Date
  },
): T & InsertContractFields {
  const now = opts?.now ?? nowTimestamp()
  const out: T & InsertContractFields = { ...values }
  if (opts?.sessionId !== undefined) {
    out.sessionId = opts.sessionId
  }
  if (out.createdAt === undefined) {
    out.createdAt = now
  }
  if (opts?.withUpdated) {
    out.updatedAt = now
  }
  return out
}
