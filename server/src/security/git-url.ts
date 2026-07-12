/**
 * Sanitize git remote URLs for skill sync (clone/pull).
 * Allowlist https (and optional ssh); reject option-injection and file: URLs.
 */

const SSH_GIT_RE = /^(?:git@[\w.-]+:[\w./~-]+\.git|ssh:\/\/(?:git@)?[\w.-]+(?::\d+)?\/[\w./~-]+\.git)$/i

export type GitUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string }

/**
 * Validate a git remote URL before passing to `git clone` / `git pull`.
 * - https:// only by default; set `allowSsh` for git@ / ssh://
 * - Rejects URLs starting with `-` (option injection)
 * - Rejects file:, git://, and other schemes
 */
export function validateGitUrl(
  raw: string,
  opts?: { allowSsh?: boolean },
): GitUrlValidation {
  const url = raw.trim()
  if (!url) return { ok: false, error: 'Git URL is required' }
  if (url.startsWith('-')) {
    return { ok: false, error: 'Git URL must not start with "-"' }
  }
  if (/[\0\r\n]/.test(url)) {
    return { ok: false, error: 'Git URL contains invalid characters' }
  }

  const lower = url.toLowerCase()
  if (lower.startsWith('file:')) {
    return { ok: false, error: 'file: git URLs are not allowed' }
  }
  if (lower.startsWith('git://')) {
    return { ok: false, error: 'git:// URLs are not allowed' }
  }

  if (lower.startsWith('https://')) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'Only https git URLs are allowed' }
      }
      if (!parsed.hostname) {
        return { ok: false, error: 'Git URL hostname required' }
      }
      return { ok: true, url }
    } catch {
      return { ok: false, error: 'Invalid https git URL' }
    }
  }

  if (opts?.allowSsh && SSH_GIT_RE.test(url)) {
    return { ok: true, url }
  }

  if (lower.startsWith('http://')) {
    return { ok: false, error: 'http git URLs are not allowed; use https' }
  }

  return {
    ok: false,
    error: opts?.allowSsh
      ? 'Git URL must be https:// or ssh (git@host:path.git)'
      : 'Git URL must be https://',
  }
}
