/**
 * CSP-safe Scalar init (external file — no inline scripts).
 * Loads /api/openapi.json from the same origin.
 */
Scalar.createApiReference('#app', {
  url: '/api/openapi.json',
  withDefaultFonts: false,
})
