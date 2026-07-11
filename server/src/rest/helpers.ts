import { z } from 'zod'

export async function parseJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export async function readBody(req: Request): Promise<string> {
  return req.text()
}

export const idParam = z.string().uuid()
