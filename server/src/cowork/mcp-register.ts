/**
 * Open Cowork MCP client registration for the Jarvis bridge (Slice B).
 *
 * Upserts an entry into `%APPDATA%/open-cowork/mcp-config.json`
 * (shape `{ "servers": [ ... ] }`) pointing Cowork at
 * `bun server/src/cowork/mcp-bridge-main.ts`.
 *
 * Write is explicit (POST /api/cowork/mcp-bridge/register) — Cowork reads the
 * config at startup, so register while Cowork is not running (or restart it).
 * Existing entries and unknown top-level fields are preserved (safe merge);
 * a malformed existing file is never overwritten.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const JARVIS_MCP_BRIDGE_ID = 'mcp-jarvis-bridge'

export type CoworkMcpServerEntry = {
  id: string
  name: string
  type: 'stdio'
  command: string
  args: string[]
  enabled: boolean
  [key: string]: unknown
}

export type CoworkMcpConfig = {
  servers: unknown[]
  [key: string]: unknown
}

export type JarvisMcpBridgeStatus = {
  registered: boolean
  /** Full command line Cowork will run (for display / manual setup). */
  command: string
  configPath: string
  hint: string
}

/** `%APPDATA%/open-cowork/mcp-config.json` (Roaming fallback for tests/CI). */
export function coworkMcpConfigPath(appData = process.env.APPDATA): string {
  const base = appData?.trim() || join(homedir(), 'AppData', 'Roaming')
  return join(base, 'open-cowork', 'mcp-config.json')
}

/** Absolute path to the bridge CLI entry next to this module. */
export function jarvisBridgeScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, 'mcp-bridge-main.ts')
}

/** Resolve the bun executable (Windows installs often omit `bun` from PATH). */
export function resolveBunForBridge(): string {
  if (process.execPath.toLowerCase().includes('bun')) return process.execPath
  const bunBin = process.platform === 'win32' ? 'bun.exe' : 'bun'
  if (process.env.BUN_INSTALL) {
    const candidate = join(process.env.BUN_INSTALL, 'bin', bunBin)
    if (existsSync(candidate)) return candidate
  }
  const home = process.platform === 'win32' ? (process.env.USERPROFILE ?? '') : (process.env.HOME ?? '')
  const local = join(home, '.bun', 'bin', bunBin)
  if (existsSync(local)) return local
  return 'bun'
}

export function buildJarvisBridgeEntry(opts?: {
  command?: string
  scriptPath?: string
}): CoworkMcpServerEntry {
  return {
    id: JARVIS_MCP_BRIDGE_ID,
    name: 'Jarvis',
    type: 'stdio',
    command: opts?.command ?? resolveBunForBridge(),
    args: ['run', opts?.scriptPath ?? jarvisBridgeScriptPath()],
    enabled: true,
  }
}

function formatCommand(entry: CoworkMcpServerEntry): string {
  return [entry.command, ...entry.args].map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')
}

/** Read + parse the Cowork MCP config. `null` when the file does not exist. */
export async function readCoworkMcpConfig(configPath: string): Promise<CoworkMcpConfig | null> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch {
    return null
  }
  const parsed = JSON.parse(raw) as unknown // malformed → throws; caller must not clobber
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Cowork MCP config at ${configPath} is not a JSON object`)
  }
  const obj = parsed as Record<string, unknown>
  return { ...obj, servers: Array.isArray(obj.servers) ? obj.servers : [] }
}

function findBridgeEntry(config: CoworkMcpConfig): CoworkMcpServerEntry | null {
  for (const item of config.servers) {
    if (
      item &&
      typeof item === 'object' &&
      (item as { id?: unknown }).id === JARVIS_MCP_BRIDGE_ID
    ) {
      return item as CoworkMcpServerEntry
    }
  }
  return null
}

/**
 * Upsert the Jarvis bridge entry (safe merge: other servers and unknown
 * fields — including extra fields on an existing bridge entry — survive).
 */
export async function registerJarvisMcpBridge(opts?: {
  configPath?: string
  entry?: CoworkMcpServerEntry
}): Promise<JarvisMcpBridgeStatus> {
  const configPath = opts?.configPath ?? coworkMcpConfigPath()
  const entry = opts?.entry ?? buildJarvisBridgeEntry()

  const existing = (await readCoworkMcpConfig(configPath)) ?? { servers: [] }
  const prior = findBridgeEntry(existing)
  const merged: CoworkMcpServerEntry = { ...prior, ...entry }
  const servers = prior
    ? existing.servers.map((s) =>
        s && typeof s === 'object' && (s as { id?: unknown }).id === JARVIS_MCP_BRIDGE_ID
          ? merged
          : s,
      )
    : [...existing.servers, merged]

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ ...existing, servers }, null, 2) + '\n', 'utf8')

  return {
    registered: true,
    command: formatCommand(merged),
    configPath,
    hint: 'Registered. Restart Open Cowork so it picks up the MCP config.',
  }
}

/** Non-writing status for GET /api/cowork/setup. */
export async function getJarvisMcpBridgeStatus(opts?: {
  configPath?: string
}): Promise<JarvisMcpBridgeStatus> {
  const configPath = opts?.configPath ?? coworkMcpConfigPath()
  const expected = buildJarvisBridgeEntry()
  let registered = false
  try {
    const config = await readCoworkMcpConfig(configPath)
    const entry = config ? findBridgeEntry(config) : null
    registered = Boolean(entry && entry.enabled !== false)
  } catch {
    registered = false // malformed file → treat as not registered
  }
  return {
    registered,
    command: formatCommand(expected),
    configPath,
    hint: registered
      ? 'Jarvis MCP bridge is registered with Open Cowork.'
      : 'Not registered. POST /api/cowork/mcp-bridge/register (with Open Cowork closed), then start Cowork.',
  }
}
