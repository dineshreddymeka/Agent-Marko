import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { config } from '../config'
import { jsonResponse, parseJson } from './helpers'

function root(): string {
  return resolve(process.cwd(), config.WORKSPACE_ROOT)
}

function jail(relative: string): string {
  const full = resolve(root(), relative)
  if (!full.startsWith(root())) throw new Error('Path escapes workspace')
  return full
}

export async function handleWorkspace(req: Request, path: string): Promise<Response | null> {
  const parts = path.split('/').filter(Boolean)
  const url = new URL(req.url)

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'tree') {
    const rel = url.searchParams.get('path') ?? '.'
    const dir = jail(rel)
    const entries = await readdir(dir, { withFileTypes: true })
    return jsonResponse({
      path: rel,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: join(rel, e.name).replace(/\\/g, '/'),
      })),
    })
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'file') {
    const rel = url.searchParams.get('path')
    if (!rel) return jsonResponse({ error: 'path required' }, 400)
    const content = await readFile(jail(rel), 'utf8')
    return jsonResponse({ path: rel, content })
  }

  if (req.method === 'PUT' && parts.length === 3 && parts[2] === 'file') {
    const body = await parseJson(req)
    if (!body?.path) return jsonResponse({ error: 'path required' }, 400)
    const filePath = jail(String(body.path))
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, String(body.content ?? ''), 'utf8')
    return jsonResponse({ ok: true })
  }

  return null
}
