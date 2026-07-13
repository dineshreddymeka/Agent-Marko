import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot } from '../src/paths'
import {
  AGUI_TROUBLESHOOT_MAX_ITEMS,
  AGUI_TROUBLESHOOT_REPORT_REL,
  buildAguiTroubleshootSteering,
  fetchAguiTroubleshootBrief,
  loadLocalAguiReport,
  summarizeAguiReport,
} from '../src/agent/agui-troubleshoot'
import { looksLikeAguiTroubleshootIntent } from '../src/agent/agui-troubleshoot-intent'

describe('agui troubleshoot report', () => {
  test('local report exists with 20 numbered issues', async () => {
    const raw = await loadLocalAguiReport()
    expect(raw).not.toBeNull()
    const count = (raw!.match(/^##\s+\d+\.\s+/gm) ?? []).length
    expect(count).toBe(20)
  })

  test('summarizeAguiReport caps at max items', async () => {
    const raw = await readFile(join(repoRoot(), AGUI_TROUBLESHOOT_REPORT_REL), 'utf8')
    const summary = summarizeAguiReport(raw, 5)
    const count = (summary.match(/^##\s+\d+\.\s+/gm) ?? []).length
    expect(count).toBe(5)
    expect(summary.length).toBeLessThanOrEqual(24_000)
  })

  test('fetchAguiTroubleshootBrief returns local summary without web failure', async () => {
    const brief = await fetchAguiTroubleshootBrief('debug agui chat blank', new AbortController().signal)
    expect(['local', 'local+web']).toContain(brief.source)
    expect(brief.summary).toContain('## 1.')
    expect(brief.itemCount).toBeGreaterThan(0)
    expect(brief.itemCount).toBeLessThanOrEqual(AGUI_TROUBLESHOOT_MAX_ITEMS)
  })
})

describe('agui troubleshoot context routing', () => {
  test('steering section includes brief when summary provided', () => {
    const section = buildAguiTroubleshootSteering('## 1. Sample issue\n- **Symptom**: blank chat')
    expect(section).toContain('AG-UI / A2UI troubleshooting')
    expect(section).toContain('Sample issue')
    expect(section).toContain('user explicitly asked')
  })

  test('runtime only fetches when intent matches (gate contract)', () => {
    expect(looksLikeAguiTroubleshootIntent('summarize my notes')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('troubleshoot AGUI blank chat')).toBe(true)
  })
})
