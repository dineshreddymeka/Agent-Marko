/** Custom A2UI catalog component ids and prop schemas (Phase 5+) */

export type HermesCatalogComponentId =
  | 'hermes:SkillCard'
  | 'hermes:MemoryEntryEditor'
  | 'hermes:CronSchedulePicker'
  | 'hermes:FileDiff'

export interface SkillCardProps {
  skillId: string
  name: string
  description: string
  source: string
}

export interface MemoryEntryEditorProps {
  entryId?: string
  kind: 'semantic' | 'episodic' | 'preference'
  content: string
  importance: number
}

export interface CronSchedulePickerProps {
  schedule: string
  timezone?: string
}

export interface FileDiffProps {
  path: string
  before: string
  after: string
}

export type HermesCatalogProps =
  | SkillCardProps
  | MemoryEntryEditorProps
  | CronSchedulePickerProps
  | FileDiffProps

export const HERMES_CATALOG_IDS: HermesCatalogComponentId[] = [
  'hermes:SkillCard',
  'hermes:MemoryEntryEditor',
  'hermes:CronSchedulePicker',
  'hermes:FileDiff',
]
