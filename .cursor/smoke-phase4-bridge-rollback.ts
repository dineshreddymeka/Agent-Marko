/** Phase 4 bridge progress/question + HERMES_ROUTING=legacy rollback smoke. */
import { join } from 'node:path'
import { resolveBunExecutable } from '../scripts/lib/bun-path.ts'
import {
  bridgeEntriesFromEvents,
  COWORK_PROGRESS_EVENT,
  COWORK_QUESTION_EVENT,
  handleAsk,
  handleReportProgress,
  resetJarvisMcpBridgeGuardrailsForTests,
} from '../server/src/cowork/mcp-bridge.ts'
import {
  listCoworkTaskProgress,
  listCoworkTaskQuestions,
  resetCoworkTaskStateForTests,
} from '../server/src/cowork/run-task.ts'

const root = join(import.meta.dir, '..')
const bun = resolveBunExecutable()
const port = 3098

function rec(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
  return ok
}

resetCoworkTaskStateForTests()
resetJarvisMcpBridgeGuardrailsForTests()

const progress = await handleReportProgress(
  { taskId: 't-20260712-smoke', message: 'phase4 smoke progress', percent: 42 },
  { persist: false },
)
const ask = await handleAsk(
  { taskId: 't-20260712-smoke', question: 'phase4 smoke question?' },
  { persist: false },
)

const rec1 = rec(
  'cowork bridge progress handler',
  progress.ok === true &&
    progress.entry.percent === 42 &&
    listCoworkTaskProgress('t-20260712-smoke').length === 1,
  JSON.stringify(progress),
)
const rec2 = rec(
  'cowork bridge ask/question handler',
  ask.ok === true &&
    typeof ask.questionId === 'string' &&
    listCoworkTaskQuestions('t-20260712-smoke').length === 1,
  JSON.stringify(ask),
)

const entries = bridgeEntriesFromEvents([
  {
    eventType: COWORK_PROGRESS_EVENT,
    payload: {
      taskId: 't-20260712-smoke',
      message: 'from event',
      percent: 10,
      at: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  },
  {
    eventType: COWORK_QUESTION_EVENT,
    payload: {
      taskId: 't-20260712-smoke',
      questionId: 'q1',
      question: 'from event?',
      at: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  },
])
const rec3 = rec(
  'cowork bridge event extraction',
  entries.progress.length === 1 && entries.questions.length === 1,
  JSON.stringify(entries),
)

const proc = Bun.spawn([bun, 'src/index.ts'], {
  cwd: join(root, 'server'),
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    HERMES_ROUTING: 'legacy',
    HERMES_MOCK_LLM: '1',
    AUTO_APPROVE_ALL: 'true',
    ALLOW_SIGNUP: 'false',
  },
})

async function waitHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return await res.json()
      last = await res.text()
    } catch (e) {
      last = String(e)
    }
    await Bun.sleep(300)
  }
  throw new Error(`legacy server health timeout: ${last}`)
}

let rec4 = false
let rec5 = false
try {
  await waitHealth()
  const health = (await fetch(`http://127.0.0.1:${port}/api/debug/health`).then((r) => r.json())) as any
  const caps = (await fetch(`http://127.0.0.1:${port}/api/capabilities`).then((r) => r.json())) as any
  rec4 = rec(
    'rollback HERMES_ROUTING=legacy (debug health)',
    health.agentLlm?.routing === 'legacy' &&
      (health.capabilities?.routing === 'legacy' || caps.routing === 'legacy'),
    `agentLlm.routing=${health.agentLlm?.routing} capabilities.routing=${health.capabilities?.routing ?? caps.routing} retrievalMode=${caps.retrievalMode}`,
  )
  rec5 = rec(
    'rollback legacy retrievalMode',
    caps.routing === 'legacy' && caps.retrievalMode === 'legacy',
    `routing=${caps.routing} retrievalMode=${caps.retrievalMode} tools=${(caps.tools || []).length}`,
  )
} catch (err) {
  rec('rollback HERMES_ROUTING=legacy (debug health)', false, err instanceof Error ? err.message : String(err))
  rec('rollback legacy retrievalMode', false, 'skipped due to server start failure')
} finally {
  proc.kill()
  try {
    await proc.exited
  } catch {
    /* ignore */
  }
}

const ok = rec1 && rec2 && rec3 && rec4 && rec5
console.log(`\nbridge_rollback_ok=${ok}`)
process.exit(ok ? 0 : 1)
