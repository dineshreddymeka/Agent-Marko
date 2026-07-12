export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOptions = RequestInit & {
  params?: Record<string, string | number | boolean | undefined>
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(path, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  return url.pathname + url.search
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers, ...init } = options
  const url = buildUrl(path, params)

  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    credentials: 'include',
  })

  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as {
        message?: string
        error?: string
        code?: string
      }
      message =
        body.message ??
        (typeof body.error === 'string' ? body.error : undefined) ??
        message
      throw new ApiError(message, res.status, body.code)
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(message, res.status)
    }
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const apiClient = {
  get: <T>(path: string, params?: RequestOptions['params']) =>
    api<T>(path, { method: 'GET', params }),
  post: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => api<T>(path, { method: 'DELETE' }),
}
