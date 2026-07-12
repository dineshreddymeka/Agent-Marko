export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  return (await req.json()) as T
}

import { resolveCorsOrigin } from '../security/cors'

export function withCors(req: Request, res?: Response): Response | null {
  const origin = resolveCorsOrigin(req)
  const cors: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
  if (origin) {
    cors['Access-Control-Allow-Origin'] = origin
    if (origin !== '*') cors['Access-Control-Allow-Credentials'] = 'true'
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (!res) return null
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}
