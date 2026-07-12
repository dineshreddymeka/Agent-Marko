export interface A2UISurfaceState {
  id: string
  sessionId: string | null
  components: A2UIComponent[]
  data: Record<string, unknown>
  complete: boolean
}

export interface A2UIComponent {
  id: string
  type: string
  props: Record<string, unknown>
  children?: string[]
}

const surfaces = new Map<string, A2UISurfaceState>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribeA2UI(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSurfaces(): Map<string, A2UISurfaceState> {
  return surfaces
}

export function getSurface(id: string): A2UISurfaceState | undefined {
  return surfaces.get(id)
}

export function processA2UIMessage(payload: unknown, sessionId: string | null): void {
  if (!payload || typeof payload !== 'object') return

  const msg = payload as {
    surfaceId?: string
    type?: string
    component?: A2UIComponent
    data?: Record<string, unknown>
    complete?: boolean
  }

  const surfaceId = msg.surfaceId ?? crypto.randomUUID()
  let surface = surfaces.get(surfaceId)

  if (!surface) {
    surface = {
      id: surfaceId,
      sessionId,
      components: [],
      data: {},
      complete: false,
    }
    surfaces.set(surfaceId, surface)
  }

  if (msg.component) {
    const idx = surface.components.findIndex((c) => c.id === msg.component!.id)
    if (idx >= 0) {
      surface.components[idx] = msg.component
    } else {
      surface.components.push(msg.component)
    }
  }

  if (msg.data) {
    surface.data = { ...surface.data, ...msg.data }
  }

  if (msg.complete) {
    surface.complete = true
  }

  notify()
}

/** @deprecated use sendA2UIAction from `@app/lib/a2ui/actions` */
export { sendA2UIAction } from './actions'
