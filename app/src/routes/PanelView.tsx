import { useEffect } from 'react'
import { useUiStore, type PanelName } from '@app/stores/ui'
import { SessionsPanel } from '@app/components/panels/SessionsPanel'
import { WorkspacePanel } from '@app/components/panels/WorkspacePanel'
import { SkillsPanel } from '@app/components/panels/SkillsPanel'
import { MemoryPanel } from '@app/components/panels/MemoryPanel'
import { CronPanel } from '@app/components/panels/CronPanel'
import { ProfilesPanel } from '@app/components/panels/ProfilesPanel'
import { SettingsPanel } from '@app/components/panels/SettingsPanel'

const panels: Record<PanelName, React.ComponentType> = {
  sessions: SessionsPanel,
  workspace: WorkspacePanel,
  skills: SkillsPanel,
  memory: MemoryPanel,
  cron: CronPanel,
  profiles: ProfilesPanel,
  settings: SettingsPanel,
}

interface PanelViewProps {
  name: PanelName
}

export function PanelView({ name }: PanelViewProps) {
  const setActivePanel = useUiStore((s) => s.setActivePanel)

  useEffect(() => {
    setActivePanel(name)
  }, [name, setActivePanel])

  const Panel = panels[name]
  return (
    <div className="h-full overflow-y-auto">
      <Panel />
    </div>
  )
}
