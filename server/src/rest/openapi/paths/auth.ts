import { jsonBody, jsonContent, ref } from '../helpers'

const publicSecurity: [] = []

/** better-auth mount + concrete client paths used by login.tsx */
export const authPaths = {
  '/api/auth/{path}': {
    parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
    get: {
      tags: ['Auth'],
      summary: 'better-auth handler (GET)',
      description: 'Catch-all for better-auth routes under `/api/auth/*`.',
      security: publicSecurity,
      responses: {
        '200': { description: 'Auth response (varies by route)' },
        '302': { description: 'OAuth redirect' },
      },
    },
    post: {
      tags: ['Auth'],
      summary: 'better-auth handler (POST)',
      security: publicSecurity,
      responses: {
        '200': { description: 'Auth response (varies by route)' },
      },
    },
  },
  '/api/auth/sign-in/email': {
    post: {
      tags: ['Auth'],
      summary: 'Email/password sign-in',
      security: publicSecurity,
      requestBody: jsonBody({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      }),
      responses: {
        '200': jsonContent(ref('AuthSessionResponse')),
        '401': jsonContent(ref('ApiError')),
      },
    },
  },
  '/api/auth/sign-in/social': {
    get: {
      tags: ['Auth'],
      summary: 'Social OAuth sign-in redirect',
      security: publicSecurity,
      parameters: [
        {
          name: 'provider',
          in: 'query',
          required: true,
          schema: { type: 'string', enum: ['github', 'google'] },
        },
      ],
      responses: {
        '302': { description: 'Redirect to provider' },
      },
    },
  },
  '/api/auth/get-session': {
    get: {
      tags: ['Auth'],
      summary: 'Current session',
      security: publicSecurity,
      responses: {
        '200': jsonContent({
          oneOf: [ref('AuthSessionResponse'), { type: 'null' }],
        }),
      },
    },
  },
  '/api/auth/sign-out': {
    post: {
      tags: ['Auth'],
      summary: 'Sign out',
      security: publicSecurity,
      responses: {
        '200': jsonContent(ref('OkResponse')),
      },
    },
  },
}
