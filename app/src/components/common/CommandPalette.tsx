import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from '@tanstack/react-router'
import { useUiStore, type PanelName } from '@app/stores/ui'
import { useSettingsStore } from '@app/stores/settings'
import { useSessionsStore } from '@app/stores/sessions'
import { generateId } from '@app/lib/utils'
import { Kbd } from '@app/components/common/Kbd'

const panels: { id: PanelName; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: 'Memory' },
  { id: 'cron', label: 'Cron' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'settings', label: 'Settings' },
]

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const addSession = useSessionsStore((s) => s.addSession)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const newSession = () => {
    const id = generateId()
    addSession({
      id,
      title: 'New chat',
      groupName: null,
      profileId: null,
      pinned: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setOpen(false)
    void navigate({ to: '/session/$id', params: { id } })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]">
      <Command
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-canvas-subtle shadow-2xl"
        shouldFilter
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Type a command or search…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-2 py-6 text-center text-sm text-fg-muted">
            No results found.
          </Command.Empty>

          <Command.Group heading="Actions" className="text-xs text-fg-muted">
            <Command.Item
              onSelect={newSession}
              className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-fg aria-selected:bg-accent-muted"
            >
              New session
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Panels" className="text-xs text-fg-muted">
            {panels.map((p) => (
              <Command.Item
                key={p.id}
                onSelect={() => {
                  setActivePanel(p.id)
                  setOpen(false)
                  void navigate({ to: '/panel/$name', params: { name: p.id } })
                }}
                className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-fg aria-selected:bg-accent-muted"
              >
                Open {p.label}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Theme" className="text-xs text-fg-muted">
            {(['dark', 'dim', 'light'] as const).map((t) => (
              <Command.Item
                key={t}
                onSelect={() => {
                  setTheme(t)
                  setOpen(false)
                }}
                className="cursor-pointer rounded-md px-2 py-1.5 text-sm capitalize text-fg aria-selected:bg-accent-muted"
              >
                {t} theme
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Help" className="text-xs text-fg-muted">
            <Command.Item
              disabled
              className="rounded-md px-2 py-1.5 text-sm text-fg-muted"
            >
              <span className="flex items-center gap-2">
                Toggle sidebar <Kbd>Ctrl</Kbd>+<Kbd>B</Kbd>
              </span>
            </Command.Item>
            <Command.Item
              disabled
              className="rounded-md px-2 py-1.5 text-sm text-fg-muted"
            >
              <span className="flex items-center gap-2">
                Toggle right panel <Kbd>Ctrl</Kbd>+<Kbd>Alt</Kbd>+<Kbd>B</Kbd>
              </span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
      <button
        type="button"
        className="fixed inset-0 -z-10"
        aria-label="Close palette"
        onClick={() => setOpen(false)}
      />
    </div>
  )
}
