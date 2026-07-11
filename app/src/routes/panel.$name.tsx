import { createFileRoute, notFound } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { SessionsPanel } from '@app/components/panels/SessionsPanel'
import { WorkspacePanel } from '@app/components/panels/WorkspacePanel'
import { SkillsPanel } from '@app/components/panels/SkillsPanel'
import { MemoryPanel } from '@app/components/panels/MemoryPanel'
import { CronPanel } from '@app/components/panels/CronPanel'
import { ProfilesPanel } from '@app/components/panels/ProfilesPanel'
import { SettingsPanel } from '@app/components/panels/SettingsPanel'
import type { PanelName } from '@app/stores/ui'

const panelTitles: Record<PanelName, string> = {
  sessions: 'Sessions',
  workspace: 'Workspace',
  skills: 'Skills',
  memory: 'Memory',
  cron: 'Cron Jobs',
  profiles: 'Profiles',
  settings: 'Settings',
}

const panelComponents: Record<PanelName, ComponentType> = {
  sessions: SessionsPanel,
  workspace: WorkspacePanel,
  skills: SkillsPanel,
  memory: MemoryPanel,
  cron: CronPanel,
  profiles: ProfilesPanel,
  settings: SettingsPanel,
}

export const Route = createFileRoute('/panel/$name')({
  component: PanelRoute,
})

function PanelRoute() {
  const { name } = Route.useParams()
  if (!(name in panelTitles)) {
    throw notFound()
  }
  const panelName = name as PanelName
  const title = panelTitles[panelName]
  const Panel = panelComponents[panelName]

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h1 className="text-sm font-medium text-fg">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Panel />
      </div>
    </main>
  )
}
