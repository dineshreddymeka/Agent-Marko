/* Vendored Scalar stub for offline/CI docs serving. */
var Scalar = {
  createApiReference: function (selector, opts) {
    var el = typeof selector === 'string' ? document.querySelector(selector) : selector
    if (!el) return
    var url = (opts && opts.url) || '/api/openapi.json'
    el.innerHTML =
      '<p style="font:14px/1.4 system-ui;padding:1rem">OpenAPI reference: <a href="' +
      url +
      '">' +
      url +
      '</a></p>'
  },
}
