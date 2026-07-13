import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { config } from '../config'
import { resolveInsideRoot } from '../fs/path-jail'
import { logger } from '../log'
import { jsonResponse, parseJson } from './helpers'

function root(): string {
  return config.WORKSPACE_ROOT
}

function jail(relative: string): string {
  return resolveInsideRoot(root(), relative)
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'])

function queueChangedFile(path: string): void {
  void import('../indexer/service')
    .then(({ queueWorkspaceFile }) => queueWorkspaceFile(path))
    .catch((err) => {
      logger.warn('Failed to queue workspace file index', { path, error: String(err) })
    })
}

function queueDeletedFile(path: string): void {
  void import('../indexer/service')
    .then(({ queueWorkspaceDelete }) => queueWorkspaceDelete(path))
    .catch((err) => {
      logger.warn('Failed to queue workspace file delete', { path, error: String(err) })
    })
}

export async function handleWorkspace(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  const url = new URL(req.url)

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'tree') {
    const rel = url.searchParams.get('path') ?? '.'
    const dir = jail(rel)
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return jsonResponse({
      path: rel,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: join(rel === '.' ? '' : rel, e.name).replace(/\\/g, '/').replace(/^\//, '') || e.name,
      })),
    })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'git-status') {
    const result = spawnSync('git', ['status', '--porcelain'], {
      cwd: root(),
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.error || result.status !== 0) {
      return jsonResponse({ isRepo: false, dirty: false, files: [] })
    }
    const files = (result.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return jsonResponse({ isRepo: true, dirty: files.length > 0, files })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'file') {
    const rel = url.searchParams.get('path')
    if (!rel) return jsonResponse({ error: 'path required' }, 400)
    const full = jail(rel)
    const ext = extname(rel).toLowerCase()
    if (IMAGE_EXTS.has(ext)) {
      const buf = await readFile(full)
      const mime =
        ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.webp'
                ? 'image/webp'
                : 'image/png'
      return jsonResponse({
        path: rel,
        content: null,
        encoding: 'base64',
        mime,
        contentBase64: buf.toString('base64'),
      })
    }
    const content = await readFile(full, 'utf8')
    return jsonResponse({ path: rel, content, encoding: 'utf8', mime: 'text/plain' })
  }

  if (req.method === 'PUT' && parts.length === 3 && parts[2] === 'file') {
    const body = await parseJson(req)
    if (!body?.path) return jsonResponse({ error: 'path required' }, 400)
    const filePath = jail(String(body.path))
    await mkdir(join(filePath, '..'), { recursive: true })
    if (body.encoding === 'base64') {
      const b64 =
        typeof body.contentBase64 === 'string'
          ? body.contentBase64
          : typeof body.content === 'string'
            ? body.content
            : null
      if (b64) await writeFile(filePath, Buffer.from(b64, 'base64'))
      else await writeFile(filePath, '', 'utf8')
    } else {
      await writeFile(filePath, String(body.content ?? ''), 'utf8')
    }
    queueChangedFile(String(body.path))
    return jsonResponse({ ok: true, path: body.path })
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'upload') {
    const body = await parseJson(req)
    if (!body?.path) return jsonResponse({ error: 'path required' }, 400)

    const rel = String(body.path).replace(/\\/g, '/')
    const filePath = jail(rel)
    await mkdir(join(filePath, '..'), { recursive: true })

    const encoding = body.encoding === 'base64' ? 'base64' : 'utf8'
    if (encoding === 'base64') {
      const b64 =
        typeof body.contentBase64 === 'string'
          ? body.contentBase64
          : typeof body.content === 'string'
            ? body.content
            : null
      if (!b64) return jsonResponse({ error: 'content or contentBase64 required' }, 400)
      await writeFile(filePath, Buffer.from(b64, 'base64'))
    } else {
      await writeFile(filePath, String(body.content ?? ''), 'utf8')
    }
    queueChangedFile(rel)
    return jsonResponse({ ok: true, path: rel, name: basename(rel) })
  }

  if (req.method === 'DELETE' && parts.length === 3 && parts[2] === 'file') {
    const rel = url.searchParams.get('path')
    if (!rel) return jsonResponse({ error: 'path required' }, 400)
    await unlink(jail(rel))
    queueDeletedFile(rel)
    return jsonResponse({ deleted: true })
  }

  return null
}
