import { isAbsolute, relative, resolve } from 'node:path'

/** True when `candidate` resolves inside `root` (no `..` escape, not absolute-relative). */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const absRoot = resolve(root)
  const absCandidate = resolve(candidate)
  const rel = relative(absRoot, absCandidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolve `relativePath` under `root`, rejecting parent traversal and absolute escapes.
 * Prefer this over `full.startsWith(root)` (which fails for `/workspace` vs `/workspace-evil`).
 */
export function resolveInsideRoot(root: string, relativePath: string): string {
  const absRoot = resolve(root)
  const full = resolve(absRoot, relativePath === '.' || relativePath === '' ? '.' : relativePath)
  if (!isPathInsideRoot(absRoot, full)) {
    throw new Error('Path escapes workspace root')
  }
  return full
}

/** Workspace-relative POSIX path, or throw if outside root. */
export function toWorkspaceRelative(root: string, path: string): string {
  const full = resolveInsideRoot(root, path)
  const rel = relative(resolve(root), full).replace(/\\/g, '/')
  return rel || '.'
}
