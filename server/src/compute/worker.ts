/// <reference lib="webworker" />

type InMessage = {
  id: string
  type: 'echo' | 'hash' | 'json_parse'
  payload: unknown
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data
  try {
    let result: unknown
    switch (msg.type) {
      case 'echo':
        result = msg.payload
        break
      case 'hash': {
        const data = new TextEncoder().encode(String(msg.payload ?? ''))
        const digest = await crypto.subtle.digest('SHA-256', data)
        result = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
        break
      }
      case 'json_parse':
        result = JSON.parse(String(msg.payload ?? ''))
        break
      default:
        throw new Error(`Unknown compute task: ${(msg as { type: string }).type}`)
    }
    self.postMessage({ id: msg.id, ok: true, result })
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err) })
  }
}
