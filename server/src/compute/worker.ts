// Bun worker stub for future CPU-bound offload
self.onmessage = (event: MessageEvent) => {
  self.postMessage({ ok: true, echo: event.data })
}
