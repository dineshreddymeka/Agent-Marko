import { basename, extname } from 'node:path'

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.sql',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.sh',
  '.ps1',
  '.gitignore',
  '.dockerfile',
])

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
])

/** Explicit secret filenames only — avoid matching keyboard.tsx / monkey.ts. */
const SECRET_NAME_RE =
  /(^|[/.\\])(\.env(\..+)?|.*\.pem|id_rsa|id_ed25519|credentials\.json|secrets?\.(json|ya?ml|toml|env)|.*\.key)$/i

export function normalizeIndexPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isIgnoredPath(rel: string): boolean {
  const normalized = normalizeIndexPath(rel)
  const parts = normalized.split('/')
  if (parts.some((part) => IGNORED_SEGMENTS.has(part))) return true
  if (SECRET_NAME_RE.test(normalized)) return true
  return false
}

export function isTextFile(rel: string): boolean {
  const lower = rel.toLowerCase()
  const ext = extname(lower)
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(basename(lower))
}
