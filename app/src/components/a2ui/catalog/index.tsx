import type { A2UIComponent } from '@app/lib/a2ui/processor'
import type { HermesCatalogComponentId } from '@hermes/shared'
import { SkillCard } from '@app/components/a2ui/hermes-widgets/SkillCard'
import { MemoryEntryEditor } from '@app/components/a2ui/hermes-widgets/MemoryEntryEditor'
import { CronSchedulePicker } from '@app/components/a2ui/hermes-widgets/CronSchedulePicker'
import { FileDiff } from '@app/components/a2ui/hermes-widgets/FileDiff'

export function renderCatalogComponent(
  component: A2UIComponent,
  data: Record<string, unknown>,
  onAction: (action: string, data: unknown) => void,
): React.ReactNode {
  const props = { ...component.props, ...resolveBindings(component.props, data) }

  switch (component.type) {
    case 'Text':
      return <p className="text-sm text-fg">{String(props.text ?? '')}</p>
    case 'Button':
      return (
        <button
          type="button"
          onClick={() => onAction(String(props.action ?? 'click'), props)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-emphasis"
        >
          {String(props.label ?? 'Button')}
        </button>
      )
    case 'TextField':
      return (
        <input
          type="text"
          placeholder={String(props.placeholder ?? '')}
          defaultValue={String(props.value ?? '')}
          className="w-full rounded-md border border-border bg-canvas px-3 py-1.5 text-sm text-fg"
          onChange={(e) => onAction('change', { ...props, value: e.target.value })}
        />
      )
    case 'Card':
      return (
        <div className="rounded-lg border border-border p-3">
          {props.title != null && (
            <h4 className="mb-2 text-sm font-medium text-fg">{String(props.title)}</h4>
          )}
          {props.children != null && (
            <div className="text-sm text-fg-muted">{String(props.children)}</div>
          )}
        </div>
      )
    case 'Divider':
      return <hr className="my-2 border-border" />
    case 'ProgressBar':
      return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-canvas-inset">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Number(props.value ?? 0)}%` }}
          />
        </div>
      )
    case 'hermes:SkillCard' as HermesCatalogComponentId:
      return (
        <SkillCard
          name={String(props.name ?? '')}
          description={props.description != null ? String(props.description) : undefined}
          usageCount={props.usageCount != null ? Number(props.usageCount) : undefined}
          onAction={onAction}
        />
      )
    case 'hermes:MemoryEntryEditor':
      return (
        <MemoryEntryEditor
          entryId={props.entryId != null ? String(props.entryId) : undefined}
          kind={(props.kind as 'semantic' | 'episodic' | 'preference') ?? 'semantic'}
          content={String(props.content ?? '')}
          onAction={onAction}
        />
      )
    case 'hermes:CronSchedulePicker':
      return (
        <CronSchedulePicker
          name={props.name != null ? String(props.name) : undefined}
          schedule={props.schedule != null ? String(props.schedule) : undefined}
          prompt={props.prompt != null ? String(props.prompt) : undefined}
          onAction={onAction}
        />
      )
    case 'hermes:FileDiff':
      return (
        <FileDiff
          path={String(props.path ?? '')}
          before={String(props.before ?? '')}
          after={String(props.after ?? '')}
        />
      )
    default:
      return (
        <div className="rounded border border-dashed border-border p-2 text-xs text-fg-muted">
          Unknown component: {component.type}
        </div>
      )
  }
}

function resolveBindings(
  props: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const path = value.slice(2, -2).trim()
      resolved[key] = data[path]
    } else {
      resolved[key] = value
    }
  }
  return resolved
}
