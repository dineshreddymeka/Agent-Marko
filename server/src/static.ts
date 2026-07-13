import { existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { repoRoot } from './paths'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function distRoot(): string {
  return join(repoRoot(), 'app', 'dist')
}

function safePath(urlPath: string): string | null {
  const rel = urlPath.replace(/^\/+/, '') || 'index.html'
  const abs = normalize(join(distRoot(), rel))
  const root = normalize(distRoot())
  if (!abs.startsWith(root + sep) && abs !== root) return null
  return abs
}

/** Serve built Vite app (`app/dist`) — fleet production (single port). */
export async function tryServeStatic(req: Request): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null
  const url = new URL(req.url)
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/agui') ||
    url.pathname === '/health'
  ) {
    return null
  }

  const root = distRoot()
  if (!existsSync(join(root, 'index.html'))) {
    return null
  }

  let filePath = safePath(url.pathname)
  if (!filePath || !existsSync(filePath) || filePath.endsWith(sep)) {
    filePath = safePath('/index.html')
  }
  if (!filePath || !existsSync(filePath)) {
    return new Response('UI build missing — run `bun run build`', { status: 503 })
  }

  const ext = filePath.slice(filePath.lastIndexOf('.'))
  const type = MIME[ext] ?? 'application/octet-stream'
  const file = Bun.file(filePath)
  if (req.method === 'HEAD') {
    return new Response(null, { headers: { 'Content-Type': type } })
  }
  return new Response(file, { headers: { 'Content-Type': type } })
}

export function staticDistPath(): string {
  return distRoot()
}
