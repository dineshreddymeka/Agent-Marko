import { useSettingsStore } from '@app/stores/settings'
import { useUiStore, type PanelName } from '@app/stores/ui'

export interface FrontendTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const registry: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  open_file_preview: async (args) => {
    const path = args.path as string
    useUiStore.getState().setActivePanel('workspace')
    return { opened: path }
  },
  switch_panel: async (args) => {
    const panel = args.panel as PanelName
    useUiStore.getState().setActivePanel(panel)
    return { panel }
  },
  render_chart: async (args) => {
    const data = args.data as number[]
    const svg = `<svg width="200" height="40">${data
      .map((v, i) => {
        const h = Math.max(2, (v / Math.max(...data)) * 36)
        return `<rect x="${i * 12}" y="${40 - h}" width="10" height="${h}" fill="var(--color-accent)"/>`
      })
      .join('')}</svg>`
    return { svg }
  },
  set_theme: async (args) => {
    const theme = args.theme as 'dark' | 'dim' | 'light'
    useSettingsStore.getState().setTheme(theme)
    return { theme }
  },
}

export function getFrontendTools(): FrontendTool[] {
  return Object.entries(registry).map(([name]) => ({
    name,
    description: `Frontend tool: ${name}`,
    parameters: { type: 'object', properties: {} },
  }))
}

export async function executeFrontendTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const handler = registry[name]
  if (!handler) throw new Error(`Unknown frontend tool: ${name}`)
  return handler(args)
}
