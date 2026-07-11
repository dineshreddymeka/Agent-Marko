import { useAgentStateStore } from '@app/stores/agentState'
import { Plus, Trash2 } from 'lucide-react'
import { generateId } from '@app/lib/utils'

export function AgentStatePanel() {
  const state = useAgentStateStore((s) => s.state)
  const updateField = useAgentStateStore((s) => s.updateField)

  const todos = state.todos ?? []

  const addTodo = () => {
    updateField('todos', [...todos, { id: generateId(), text: '', done: false }])
  }

  const updateTodo = (id: string, patch: Partial<{ id: string; text: string; done: boolean }>) => {
    updateField(
      'todos',
      todos.map((t: { id: string; text: string; done: boolean }) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    )
  }

  const removeTodo = (id: string) => {
    updateField(
      'todos',
      todos.filter((t: { id: string }) => t.id !== id),
    )
  }

  return (
    <div className="space-y-4 p-3 text-sm">
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
          Todos
        </h3>
        <ul className="space-y-1">
          {todos.map((todo: { id: string; text: string; done: boolean }) => (
            <li key={todo.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={todo.done}
                onChange={(e) => updateTodo(todo.id, { done: e.target.checked })}
              />
              <input
                type="text"
                value={todo.text}
                onChange={(e) => updateTodo(todo.id, { text: e.target.value })}
                className="flex-1 rounded border border-border bg-canvas px-2 py-0.5 text-xs text-fg"
              />
              <button
                type="button"
                onClick={() => removeTodo(todo.id)}
                className="text-fg-muted hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addTodo}
          className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Plus size={12} /> Add todo
        </button>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
          Plan
        </h3>
        <textarea
          value={state.plan ?? ''}
          onChange={(e) => updateField('plan', e.target.value)}
          rows={6}
          className="w-full rounded border border-border bg-canvas px-2 py-1 font-mono text-xs text-fg"
          placeholder="Agent plan…"
        />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
          State JSON
        </h3>
        <pre className="max-h-40 overflow-auto rounded border border-border bg-canvas-inset p-2 font-mono text-[11px] text-fg-muted">
          {JSON.stringify(state, null, 2)}
        </pre>
      </section>
    </div>
  )
}
