import { useSyncExternalStore } from 'react'
import {
  getSurface,
  subscribeA2UI,
  sendA2UIAction,
  type A2UIComponent,
} from '@app/lib/a2ui/processor'
import { renderCatalogComponent } from '@app/components/a2ui/catalog'
import { Skeleton } from '@app/components/common/Skeleton'

interface A2UISurfaceProps {
  surfaceId: string
}

export function A2UISurface({ surfaceId }: A2UISurfaceProps) {
  useSyncExternalStore(subscribeA2UI, () => getSurface(surfaceId)?.complete ?? false)
  const surface = getSurface(surfaceId)

  if (!surface) {
    return (
      <div className="my-2 space-y-2 rounded-lg border border-border p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-border bg-canvas-subtle p-3">
      {surface.components.map((component) => (
        <CatalogNode
          key={component.id}
          component={component}
          data={surface.data}
          onAction={(action, data) => sendA2UIAction(surfaceId, action, data)}
        />
      ))}
      {!surface.complete && <Skeleton className="mt-2 h-6 w-1/2" />}
    </div>
  )
}

function CatalogNode({
  component,
  data,
  onAction,
}: {
  component: A2UIComponent
  data: Record<string, unknown>
  onAction: (action: string, data: unknown) => void
}) {
  return renderCatalogComponent(component, data, onAction)
}
