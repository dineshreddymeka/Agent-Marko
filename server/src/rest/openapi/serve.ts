import { join } from 'node:path'
import { buildOpenApiDocument } from './document'

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open Jarvis API</title>
    <style>
      html, body { margin: 0; height: 100%; }
      #app { height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="/api/docs/assets/scalar.js"></script>
    <script src="/api/docs/assets/init.js"></script>
  </body>
</html>
`

function publicDir(): string {
  // server/src/rest/openapi → server/public/api-docs
  return join(import.meta.dir, '../../../public/api-docs')
}

function contentType(filename: string): string {
  if (filename.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filename.endsWith('.map')) return 'application/json'
  return 'application/octet-stream'
}

/** Serve OpenAPI JSON, Scalar HTML, and vendored assets (unguarded). */
export async function handleOpenApiDocs(req: Request): Promise<Response | null> {
  const url = new URL(req.url)
  const path = url.pathname

  if (req.method === 'GET' && path === '/api/openapi.json') {
    return Response.json(buildOpenApiDocument(), {
      headers: {
        'cache-control': 'no-store',
      },
    })
  }

  if (req.method === 'GET' && (path === '/api/docs' || path === '/api/docs/')) {
    return new Response(DOCS_HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  if (req.method === 'GET' && path.startsWith('/api/docs/assets/')) {
    const name = path.slice('/api/docs/assets/'.length)
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const file = Bun.file(join(publicDir(), name))
    if (!(await file.exists())) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return new Response(file, {
      headers: {
        'content-type': contentType(name),
        'cache-control': 'public, max-age=86400',
      },
    })
  }

  return null
}
