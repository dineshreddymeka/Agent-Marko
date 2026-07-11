export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  return (await req.json()) as T
}

export function withCors(req: Request, res?: Response): Response | null {
  const origin = req.headers.get('Origin') ?? '*'
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      },
    })
  }
  if (!res) return null
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Credentials', 'true')
  return new Response(res.body, { status: res.status, headers })
}
