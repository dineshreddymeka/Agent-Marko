/** Shared OpenAPI 3.1 helpers for Hermes REST docs. */

export type JsonSchema = Record<string, unknown>

export function ref(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` }
}

export function jsonContent(schema: JsonSchema, description?: string) {
  return {
    description: description ?? 'OK',
    content: {
      'application/json': { schema },
    },
  }
}

export function jsonBody(schema: JsonSchema, description?: string) {
  return {
    required: true,
    description,
    content: {
      'application/json': { schema },
    },
  }
}

export function errorResponses(extra?: Record<string, unknown>) {
  return {
    '400': jsonContent(ref('ApiError'), 'Bad request'),
    '401': jsonContent(ref('ApiError'), 'Unauthorized'),
    '404': jsonContent(ref('ApiError'), 'Not found'),
    ...extra,
  }
}

export const bearerOrSession = [{ SessionCookie: [] }, { BearerToken: [] }]
