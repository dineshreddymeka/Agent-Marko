import { schemas } from './schemas'
import { sessionsPaths } from './paths/sessions'
import { skillsPaths } from './paths/skills'
import { memoryPaths } from './paths/memory'
import { cronPaths } from './paths/cron'
import { coworkPaths } from './paths/cowork'
import { officePaths } from './paths/office'
import { mcpPaths } from './paths/mcp'
import { tokensPaths } from './paths/tokens'
import { profilesPaths } from './paths/profiles'
import { settingsPaths } from './paths/settings'
import { workspacePaths } from './paths/workspace'
import { searchPaths } from './paths/search'
import { indexerPaths } from './paths/indexer'
import { debugPaths } from './paths/debug'
import { approvalPaths } from './paths/approval'
import { healthPaths } from './paths/health'
import { capabilitiesPaths } from './paths/capabilities'
import { aguiPaths } from './paths/agui'
import { authPaths } from './paths/auth'

export const openApiTags = [
  { name: 'Chat/AG-UI', description: 'Agent runs over AG-UI SSE' },
  { name: 'Sessions', description: 'Chat sessions and messages' },
  { name: 'Skills', description: 'Skill library sync and CRUD' },
  { name: 'Memory', description: 'Long-term memory entries' },
  {
    name: 'Cron',
    description:
      'Scheduled tasks. Built-in **DB Consistency**, **Bug Bounty**, and **Status Auto-Approve** jobs seed on boot at `*/2 * * * *` (check → auto-fix / auto-approve) (`GET /api/cron/system`).',
  },
  { name: 'Cowork', description: 'Open Cowork desktop work requests' },
  { name: 'Office/Briefing', description: 'Microsoft Graph calendar briefing' },
  { name: 'MCP', description: 'MCP server connections' },
  { name: 'API Tokens', description: 'Bearer API tokens (hrm_*)' },
  { name: 'Profiles', description: 'LLM profiles' },
  { name: 'Settings', description: 'App settings key/value store' },
  { name: 'Workspace', description: 'Workspace filesystem' },
  { name: 'Search', description: 'Hybrid + recall search' },
  { name: 'Indexer', description: 'Jarvis recall indexer' },
  { name: 'Debug', description: 'Diagnostics and run replay' },
  { name: 'Capabilities', description: 'Capability Hub manifest, warm path, agent LLM health' },
  { name: 'Approval', description: 'Dangerous tool approval' },
  { name: 'Auth', description: 'better-auth session / social login' },
  { name: 'Health', description: 'Health and API docs' },
]

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Open Jarvis API',
      version: '0.1.0',
      description: [
        'REST + AG-UI HTTP contract for Open Jarvis (Hermes UI).',
        '',
        '**Auth:** Prefer the better-auth session cookie, or `Authorization: Bearer hrm_*` API tokens.',
        'When `HOST=127.0.0.1` and `ALLOW_SIGNUP=false`, localhost requests bypass auth (dev-only).',
        '',
        '**Database:** Resource schemas include `x-db-table` pointing at Drizzle tables in `server/src/db/schema.ts`.',
        'See `docs/DATABASE-DESIGN.md` for the ERD/narrative companion.',
        '',
        '**System maintenance cron:** On boot the scheduler seeds **DB Consistency**, **Bug Bounty**, and **Status Auto-Approve** every 2 minutes. They check then auto-fix / auto-approve pending issues; results land in `cron_runs.detail.maintenance`. See `GET /api/cron/system`.',
        '',
        'Interactive docs: `/api/docs` · Machine-readable: `/api/openapi.json`.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Same origin as the API server' }],
    tags: openApiTags,
    security: [{ SessionCookie: [] }, { BearerToken: [] }],
    paths: {
      ...aguiPaths,
      ...sessionsPaths,
      ...skillsPaths,
      ...memoryPaths,
      ...cronPaths,
      ...coworkPaths,
      ...officePaths,
      ...mcpPaths,
      ...tokensPaths,
      ...profilesPaths,
      ...settingsPaths,
      ...workspacePaths,
      ...searchPaths,
      ...indexerPaths,
      ...debugPaths,
      ...capabilitiesPaths,
      ...approvalPaths,
      ...authPaths,
      ...healthPaths,
    },
    components: {
      securitySchemes: {
        SessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'better-auth session cookie (name may vary by config).',
        },
        BearerToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'hrm_',
          description: 'API token created via `/api/tokens` (prefix `hrm_`).',
        },
      },
      schemas,
    },
  }
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>
