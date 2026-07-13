import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot } from '../paths'
import { webSearch } from './tools/web'
import { logger } from '../log'

export const AGUI_TROUBLESHOOT_REPORT_REL = 'docs/agui-a2ui-top20-issues.md'
export const AGUI_TROUBLESHOOT_MAX_ITEMS = 20
export const AGUI_TROUBLESHOOT_WEB_TIMEOUT_MS = 6_000
export const AGUI_TROUBLESHOOT_MAX_WEB_RESULTS = 5
export const AGUI_TROUBLESHOOT_SUMMARY_MAX_CHARS = 24_000

export type AguiTroubleshootBrief = {
  source: 'local' | 'local+web' | 'web' | 'fallback'
  itemCount: number
  summary: string
}

/** System-prompt section injected only when user explicitly asked for AGUI/A2UI help. */
export function buildAguiTroubleshootSteering(summary: string): string {
  return [
    '## AG-UI / A2UI troubleshooting (this turn only — user explicitly asked)',
    'The user requested AGUI/A2UI troubleshooting. Use the curated findings below (Top 20 + optional fresh web hits).',
    'Match their symptoms to the closest item; give concrete fix steps and cite sources when present.',
    'You may use web_search/fetch_url for newer details if the brief does not cover their case.',
    'Do not inject this troubleshooting dump on turns where the user did not ask for AGUI/A2UI help.',
    summary,
  ].join('\n')
}

export function aguiTroubleshootReportPath(): string {
  return join(repoRoot(), AGUI_TROUBLESHOOT_REPORT_REL)
}

/** Load the curated Top 20 report from repo docs. */
export async function loadLocalAguiReport(): Promise<string | null> {
  try {
    return await readFile(aguiTroubleshootReportPath(), 'utf8')
  } catch {
    return null
  }
}

/** Extract numbered issue blocks (## N. Title) up to maxItems. */
export function summarizeAguiReport(
  markdown: string,
  maxItems = AGUI_TROUBLESHOOT_MAX_ITEMS,
): string {
  const headerRe = /^##\s+(\d+)\.\s+/gm
  const matches = [...markdown.matchAll(headerRe)]
  if (matches.length === 0) {
    return markdown.slice(0, AGUI_TROUBLESHOOT_SUMMARY_MAX_CHARS)
  }

  const sections: string[] = []
  for (let i = 0; i < matches.length && sections.length < maxItems; i++) {
    const start = matches[i].index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length
    sections.push(markdown.slice(start, end).trim())
  }

  const introEnd = matches[0].index ?? 0
  const intro = markdown.slice(0, introEnd).trim()
  const body = sections.join('\n\n')
  const combined = intro ? `${intro}\n\n${body}` : body
  return combined.slice(0, AGUI_TROUBLESHOOT_SUMMARY_MAX_CHARS)
}

function countReportItems(summary: string): number {
  const n = (summary.match(/^##\s+\d+\.\s+/gm) ?? []).length
  return n > 0 ? Math.min(n, AGUI_TROUBLESHOOT_MAX_ITEMS) : 0
}

function webQueryFromUserText(userText: string): string {
  const trimmed = userText.trim().slice(0, 120)
  return `AG-UI A2UI troubleshooting ${trimmed}`.replace(/\s+/g, ' ')
}

/**
 * Build a structured troubleshooting brief: local Top 20 report plus optional
 * fresh web search hits. Gracefully falls back when web fetch fails or times out.
 */
export async function fetchAguiTroubleshootBrief(
  userText: string,
  signal?: AbortSignal,
): Promise<AguiTroubleshootBrief> {
  const localRaw = await loadLocalAguiReport()
  let summary = localRaw ? summarizeAguiReport(localRaw) : ''
  let source: AguiTroubleshootBrief['source'] = localRaw ? 'local' : 'fallback'

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), AGUI_TROUBLESHOOT_WEB_TIMEOUT_MS)
  const linked =
    signal != null
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal

  try {
    const search = await webSearch(webQueryFromUserText(userText), linked)
    const hits = search.results.slice(0, AGUI_TROUBLESHOOT_MAX_WEB_RESULTS)
    if (hits.length > 0) {
      const webBlock = hits
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`,
        )
        .join('\n\n')
      summary = summary
        ? `${summary}\n\n## Fresh web findings (${search.provider})\n${webBlock}`
        : `## Fresh web findings (${search.provider})\n${webBlock}`
      source = localRaw ? 'local+web' : 'web'
    }
  } catch (err) {
    logger.debug('AGUI troubleshoot web fetch skipped', { error: String(err) })
  } finally {
    clearTimeout(timer)
  }

  if (!summary) {
    summary = [
      'No local AGUI/A2UI report or web results available.',
      'Check GET /api/debug/health and GET /api/capabilities?probe=1.',
      'Align @ag-ui/core and @ag-ui/client versions; migrate THINKING_* → REASONING_* per AG-UI 1.0.',
    ].join('\n')
    source = 'fallback'
  }

  const itemCount =
    countReportItems(summary) ||
    (source === 'web' || source === 'local+web'
      ? Math.min(AGUI_TROUBLESHOOT_MAX_WEB_RESULTS, AGUI_TROUBLESHOOT_MAX_ITEMS)
      : source === 'local'
        ? AGUI_TROUBLESHOOT_MAX_ITEMS
        : 0)

  return { source, itemCount, summary }
}
