/**
 * Safe Cowork taskId pattern — rejects path traversal (`../`).
 * Matches generated ids like `t-20260711-001` and allows short alphanumeric suffixes.
 */
export const COWORK_TASK_ID_RE = /^t-\d{8}-\d{3}$/

export function isSafeCoworkTaskId(taskId: string): boolean {
  return typeof taskId === 'string' && COWORK_TASK_ID_RE.test(taskId)
}
