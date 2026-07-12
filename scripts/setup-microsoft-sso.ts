/**
 * Set up Microsoft Entra SSO for Office Briefing (confidential Web app + PKCE).
 *
 * Usage:
 *   bun run office:sso-setup
 *   bun run office:sso-setup -- --open
 *   bun run office:sso-setup -- --manual   # skip Azure CLI; only write/check .env
 *
 * Requires Azure CLI (`az`) logged in for automatic app registration:
 *   az login
 *
 * Docs:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 *   https://learn.microsoft.com/en-us/graph/api/user-list-calendarview
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')
const envPath = join(root, '.env')
const REDIRECT_URI = 'http://127.0.0.1:3001/api/office/callback'
const APP_DISPLAY_NAME = 'Open Jarvis Office Briefing'
const GRAPH_RESOURCE = '00000003-0000-0000-c000-000000000000'
/** Delegated permission IDs for Microsoft Graph */
const DELEGATED = {
  User_Read: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d',
  Calendars_Read: '465a38f9-76ea-45b9-9f34-9e8b0d4b0b42',
  OnlineMeetings_Read: '1754e84d-449f-452e-8b5f-7a0bc5c8c2b6',
  offline_access: '7427e0e9-2fba-42fe-b0c0-8c85b5984185',
} as const

async function loadEnvFile(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!existsSync(envPath)) return map
  const text = await Bun.file(envPath).text()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    map.set(trimmed.slice(0, idx), trimmed.slice(idx + 1))
  }
  return map
}

async function writeEnvUpsert(updates: Record<string, string>): Promise<void> {
  const existing = existsSync(envPath) ? await Bun.file(envPath).text() : ''
  const lines = existing ? existing.split(/\r?\n/) : []
  const keys = new Set(Object.keys(updates))
  const next: string[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      next.push(line)
      continue
    }
    const idx = trimmed.indexOf('=')
    if (idx === -1) {
      next.push(line)
      continue
    }
    const key = trimmed.slice(0, idx)
    if (keys.has(key)) {
      next.push(`${key}=${updates[key]}`)
      seen.add(key)
    } else {
      next.push(line)
    }
  }

  if (!seen.has('MICROSOFT_CLIENT_ID') || !seen.has('MICROSOFT_CLIENT_SECRET')) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push('# Microsoft Graph Office SSO (Web + PKCE)')
    next.push(`MICROSOFT_REDIRECT_URI=${updates.MICROSOFT_REDIRECT_URI ?? REDIRECT_URI}`)
    next.push(`MICROSOFT_TENANT_ID=${updates.MICROSOFT_TENANT_ID ?? 'organizations'}`)
    next.push(`MICROSOFT_SSO_AUTO=${updates.MICROSOFT_SSO_AUTO ?? 'true'}`)
    for (const key of keys) {
      if (!seen.has(key)) next.push(`${key}=${updates[key]}`)
    }
  } else {
    for (const key of keys) {
      if (!seen.has(key)) next.push(`${key}=${updates[key]}`)
    }
  }

  await Bun.write(envPath, `${next.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').replace(/\n*$/, '\n')}`)
}

async function azAvailable(): Promise<boolean> {
  try {
    await $`az version`.quiet()
    return true
  } catch {
    return false
  }
}

async function azJson<T>(args: string[]): Promise<T> {
  const result = await $`az ${args} -o json`.text()
  return JSON.parse(result) as T
}

async function createEntraApp(): Promise<{ appId: string; objectId: string; secret: string; tenant: string }> {
  console.log('Creating Entra Web app registration…')
  const app = await azJson<{ appId: string; id: string }>([
    'ad',
    'app',
    'create',
    '--display-name',
    APP_DISPLAY_NAME,
    '--sign-in-audience',
    'AzureADMultipleOrgs',
    '--web-redirect-uris',
    REDIRECT_URI,
    '--enable-access-token-issuance',
    'false',
    '--enable-id-token-issuance',
    'false',
  ])

  console.log('Creating client secret…')
  const cred = await azJson<{ password: string }>([
    'ad',
    'app',
    'credential',
    'reset',
    '--id',
    app.appId,
    '--append',
    '--display-name',
    'open-jarvis-office',
    '--years',
    '1',
  ])

  console.log('Adding Microsoft Graph delegated permissions…')
  const perms = Object.values(DELEGATED)
    .map((id) => `${GRAPH_RESOURCE}=${id}`)
    .join(' ')
  // az expects space-separated api=perm pairs as separate --api-permissions args in some versions;
  // use one call per permission for compatibility.
  for (const id of Object.values(DELEGATED)) {
    try {
      await $`az ad app permission add --id ${app.appId} --api ${GRAPH_RESOURCE} --api-permissions ${id}=Scope`.quiet()
    } catch (err) {
      console.warn(`  warn: could not add permission ${id}: ${err}`)
    }
  }

  try {
    await $`az ad app permission grant --id ${app.appId} --api ${GRAPH_RESOURCE} --scope User.Read Calendars.Read OnlineMeetings.Read offline_access`.quiet()
  } catch {
    console.warn('  warn: admin consent / grant may need portal approval for your tenant.')
  }

  let tenant = 'organizations'
  try {
    const acct = await azJson<{ tenantId?: string }>(['account', 'show'])
    if (acct.tenantId) tenant = acct.tenantId
  } catch {
    // keep organizations
  }

  void perms
  return { appId: app.appId, objectId: app.id, secret: cred.password, tenant }
}

function printManualSteps(redirectUri: string) {
  console.log(`
Manual Azure setup (if CLI skipped):
  1. https://portal.azure.com → Microsoft Entra ID → App registrations → New
  2. Authentication → Add a platform → Web
  3. Redirect URI: ${redirectUri}
  4. Certificates & secrets → New client secret → copy Value
  5. API permissions → Microsoft Graph delegated:
       User.Read, Calendars.Read, OnlineMeetings.Read, offline_access
  6. Put values into .env and restart: bun run dev
`)
}

async function openSsoIfServerUp(returnTo: string): Promise<void> {
  const connectUrl = new URL('http://127.0.0.1:3001/api/office/sso')
  connectUrl.searchParams.set('returnTo', returnTo)
  try {
    const res = await fetch(connectUrl, { redirect: 'manual' })
    const location = res.headers.get('Location')
    let microsoftLogin = false
    if (location) {
      try {
        const redirect = new URL(location)
        microsoftLogin =
          redirect.protocol === 'https:' &&
          (redirect.hostname === 'login.microsoftonline.com' ||
            redirect.hostname.endsWith('.login.microsoftonline.com'))
      } catch {
        microsoftLogin = false
      }
    }
    if (microsoftLogin && location) {
      console.log('Opening Microsoft SSO…')
      if (process.platform === 'win32') {
        await $`cmd /c start "" ${location}`.quiet()
      } else if (process.platform === 'darwin') {
        await $`open ${location}`.quiet()
      } else {
        await $`xdg-open ${location}`.quiet()
      }
      return
    }
    console.log(`Server responded ${res.status}. Start the app with: bun run dev`)
    console.log(`Then open: http://127.0.0.1:5173/panel/office`)
  } catch {
    console.log('Server not running yet. Start with: bun run dev')
    console.log('Office Briefing will auto-redirect to Microsoft SSO when MICROSOFT_SSO_AUTO=true.')
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const manual = args.has('--manual')
  const open = args.has('--open')

  const env = await loadEnvFile()
  const already =
    Boolean(env.get('MICROSOFT_CLIENT_ID')?.trim()) &&
    Boolean(env.get('MICROSOFT_CLIENT_SECRET')?.trim())

  if (already && !args.has('--force')) {
    console.log('Microsoft SSO already configured in .env')
    console.log(`  MICROSOFT_CLIENT_ID=${env.get('MICROSOFT_CLIENT_ID')}`)
    console.log(`  MICROSOFT_REDIRECT_URI=${env.get('MICROSOFT_REDIRECT_URI') ?? REDIRECT_URI}`)
    console.log(`  MICROSOFT_SSO_AUTO=${env.get('MICROSOFT_SSO_AUTO') ?? 'true'}`)
    console.log('Re-run with --force to recreate / overwrite credentials.')
    if (open) await openSsoIfServerUp('http://127.0.0.1:5173/panel/office')
    return
  }

  if (manual || !(await azAvailable())) {
    if (!manual) console.log('Azure CLI not found. Writing .env placeholders only.')
    await writeEnvUpsert({
      MICROSOFT_CLIENT_ID: env.get('MICROSOFT_CLIENT_ID') ?? '',
      MICROSOFT_CLIENT_SECRET: env.get('MICROSOFT_CLIENT_SECRET') ?? '',
      MICROSOFT_TENANT_ID: env.get('MICROSOFT_TENANT_ID') ?? 'organizations',
      MICROSOFT_REDIRECT_URI: REDIRECT_URI,
      MICROSOFT_SSO_AUTO: 'true',
    })
    printManualSteps(REDIRECT_URI)
    console.log(`Updated ${envPath}`)
    return
  }

  try {
    await $`az account show`.quiet()
  } catch {
    console.error('Not logged into Azure CLI. Run: az login')
    process.exit(1)
  }

  const created = await createEntraApp()
  await writeEnvUpsert({
    MICROSOFT_CLIENT_ID: created.appId,
    MICROSOFT_CLIENT_SECRET: created.secret,
    MICROSOFT_TENANT_ID: created.tenant,
    MICROSOFT_REDIRECT_URI: REDIRECT_URI,
    MICROSOFT_SSO_AUTO: 'true',
  })

  console.log(`
Done. Wrote Microsoft SSO credentials to ${envPath}
  App ID: ${created.appId}
  Redirect: ${REDIRECT_URI}
  Tenant: ${created.tenant}
  Auto SSO: true

Next:
  1. bun run dev
  2. Open http://127.0.0.1:5173/panel/office  (Briefing tab auto-redirects to Microsoft SSO)
  Or: bun run office:sso-open
`)

  if (open) await openSsoIfServerUp('http://127.0.0.1:5173/panel/office')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
