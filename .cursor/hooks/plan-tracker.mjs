/**
 * Open Jarvis — Hermes UI rebuild plan tracker hook.
 * Author: Dinesh Reddy Meka
 *
 * Events: afterFileEdit (record paths), stop (append work log to tracker MD).
 * Windows-safe: Node + explicit stdout flush. Fail open (always exit 0).
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const STATE_DIR = join(__dirname, 'state')
const TRACKER = join(PROJECT_ROOT, 'docs', 'HERMES-UI-REBUILD-TRACKER.md')
const SOT_HINT = 'BMC-backend/HERMES-UI-PLAN.md'

const LOG_START = '<!-- HOOK:WORK-LOG:START -->'
const LOG_END = '<!-- HOOK:WORK-LOG:END -->'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return '{}'
  }
}

function emit(obj) {
  const out = JSON.stringify(obj ?? {})
  process.stdout.write(out + '\n')
  if (typeof process.stdout.write === 'function' && process.stdout.isTTY === false) {
    try {
      process.stdout.write('')
    } catch {
      /* */
    }
  }
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
}

function sessionKey(payload) {
  const roots = payload.workspace_roots ?? payload.workspaceRoots ?? []
  const conv = payload.conversation_id ?? payload.conversationId ?? 'default'
  const raw = `${conv}|${Array.isArray(roots) ? roots.join('|') : ''}`
  return createHash('sha1').update(raw).digest('hex').slice(0, 16)
}

function pendingPath(key) {
  return join(STATE_DIR, `pending-${key}.json`)
}

function loadPending(key) {
  const p = pendingPath(key)
  if (!existsSync(p)) return { files: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return { files: [] }
  }
}

function savePending(key, data) {
  ensureStateDir()
  writeFileSync(pendingPath(key), JSON.stringify(data, null, 2), 'utf8')
}

function clearPending(key) {
  const p = pendingPath(key)
  if (existsSync(p)) unlinkSync(p)
}

function normalizeFile(payload) {
  const file =
    payload.file_path ??
    payload.filePath ??
    payload.path ??
    payload.uri ??
    ''
  if (!file || typeof file !== 'string') return null
  let rel = file
  try {
    if (existsSync(PROJECT_ROOT)) {
      rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/')
      if (rel.startsWith('..')) rel = file.replace(/\\/g, '/')
    }
  } catch {
    rel = file.replace(/\\/g, '/')
  }
  // Never track hook state / node_modules noise
  if (rel.includes('node_modules/') || rel.includes('.cursor/hooks/state/')) return null
  return rel
}

function handleAfterFileEdit(payload) {
  const key = sessionKey(payload)
  const file = normalizeFile(payload)
  if (!file) {
    emit({})
    return
  }
  const pending = loadPending(key)
  if (!pending.files.includes(file)) pending.files.push(file)
  pending.updatedAt = new Date().toISOString()
  savePending(key, pending)
  emit({})
}

function formatEntry({ status, files, loopCount, when }) {
  const list =
    files.length === 0
      ? '- _(no file edits recorded this turn)_'
      : files.map((f) => `- \`${f}\``).join('\n')
  return [
    `### ${when} — agent stop`,
    '',
    `- **Status:** ${status}`,
    `- **Loop count:** ${loopCount}`,
    `- **Author tracker:** Dinesh Reddy Meka / auto-hook`,
    `- **SoT:** \`${SOT_HINT}\``,
    `- **Files touched:**`,
    list,
    '',
  ].join('\n')
}

function appendWorkLog(entry) {
  ensureStateDir()
  if (!existsSync(TRACKER)) {
    writeFileSync(
      TRACKER,
      [
        '# Open Jarvis — Hermes UI Rebuild Tracker',
        '',
        '**Author:** Dinesh Reddy Meka',
        '',
        '## Work log',
        '',
        LOG_START,
        LOG_END,
        '',
      ].join('\n'),
      'utf8',
    )
  }

  let md = readFileSync(TRACKER, 'utf8')
  if (!md.includes(LOG_START) || !md.includes(LOG_END)) {
    md += `\n\n## Work log\n\n${LOG_START}\n${LOG_END}\n`
  }

  const block = `${entry}\n`
  md = md.replace(LOG_START, `${LOG_START}\n${block}`)
  writeFileSync(TRACKER, md, 'utf8')
}

function isPlanWorthy(files) {
  const re =
    /(McpSubPanel|ConnectionsPanel|mcp_servers|0004_mcp|IconRail|HERMES-UI-PLAN|PARALLEL-AGENT|FEATURE-VERIFICATION|migrate)/i
  return files.some((f) => re.test(f))
}

function handleStop(payload) {
  const status = payload.status ?? 'completed'
  const loopCount = Number(payload.loop_count ?? payload.loopCount ?? 0)
  const key = sessionKey(payload)
  const pending = loadPending(key)
  const files = pending.files ?? []
  const when = new Date().toISOString()

  if (status === 'aborted' && files.length === 0) {
    emit({})
    return
  }

  try {
    appendWorkLog(formatEntry({ status, files, loopCount, when }))
  } catch (err) {
    // Fail open — still return JSON
    appendFileSync(
      join(STATE_DIR, 'tracker-errors.log'),
      `${when} ${String(err)}\n`,
      'utf8',
    )
  }

  clearPending(key)

  // One follow-up max: remind agent to sync SoT checklist when meaningful rebuild files changed
  if (
    status === 'completed' &&
    loopCount === 0 &&
    files.length > 0 &&
    isPlanWorthy(files)
  ) {
    emit({
      followup_message: [
        'Hermes UI rebuild tracker was updated (`docs/HERMES-UI-REBUILD-TRACKER.md`).',
        'Sync any checklist / implementation-status rows that this turn completed into the SoT plan',
        '`BMC-backend/HERMES-UI-PLAN.md` (same style as the Task checklist + Implementation status table).',
        'Author: Dinesh Reddy Meka. Do not commit unless asked.',
        `Files this turn: ${files.slice(0, 20).join(', ')}${files.length > 20 ? '…' : ''}`,
      ].join(' '),
    })
    return
  }

  emit({})
}

function main() {
  const mode = process.argv.includes('--stop')
    ? 'stop'
    : process.argv.includes('--edit')
      ? 'edit'
      : 'auto'

  let payload = {}
  try {
    payload = JSON.parse(readStdin() || '{}')
  } catch {
    payload = {}
  }

  // Infer event if not passed via argv
  const event =
    mode !== 'auto'
      ? mode
      : payload.hook_event_name ??
        payload.hookEventName ??
        (payload.file_path || payload.filePath || payload.path ? 'edit' : 'stop')

  if (event === 'edit' || event === 'afterFileEdit') {
    handleAfterFileEdit(payload)
  } else {
    handleStop(payload)
  }
}

try {
  main()
} catch {
  emit({})
  process.exit(0)
}
