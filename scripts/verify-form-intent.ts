/**
 * One-shot verify: form interceptor returns A2UI FormRequestForm (no LLM needed).
 * Greeting is checked via intent helpers (avoids hung bridge on live "hi").
 * Run from repo root: bun run scripts/verify-form-intent.ts
 */
import { EventType, type RunAgentInput } from '@ag-ui/core'
import { randomUUID } from 'node:crypto'
import {
  looksLikeFormIntent,
  shouldAutoShowFormRequest,
} from '../server/src/agent/form-intent'

const { runNativeAgent } = await import('../server/src/agent/runtime')

const events: Array<{
  type: string
  name?: string
  delta?: string
  value?: unknown
  toolCallName?: string
}> = []

const input: RunAgentInput = {
  threadId: randomUUID(),
  runId: randomUUID(),
  messages: [{ id: randomUUID(), role: 'user', content: 'can you make me a form' }],
  tools: [],
  context: [],
  state: {},
}

const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), 15_000)
const started = performance.now()
try {
  await runNativeAgent(
    input,
    async (ev) => {
      const e = ev as {
        type: string
        name?: string
        delta?: string
        value?: unknown
        toolCallName?: string
      }
      events.push({
        type: String(e.type),
        name: e.name,
        delta: e.delta,
        value: e.value,
        toolCallName: e.toolCallName,
      })
    },
    ac.signal,
  )
} finally {
  clearTimeout(timer)
}
const ms = Math.round(performance.now() - started)

const text = events
  .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT && e.delta)
  .map((e) => e.delta)
  .join('')
const tools = events.filter((e) => e.toolCallName).map((e) => e.toolCallName)
const a2uiTypes = events
  .filter((e) => e.name === 'a2ui.message')
  .map((e) => (e.value as { component?: { type?: string } })?.component?.type)

const okForm =
  tools.includes('form_request_show') &&
  a2uiTypes.includes('hermes:FormRequestForm') &&
  /Opening the form builder/i.test(text) &&
  !/Preparing to respond/i.test(text) &&
  !/What can I help/i.test(text) &&
  ms < 10_000

const okHiIntent =
  !looksLikeFormIntent('hi') &&
  !shouldAutoShowFormRequest('hi') &&
  looksLikeFormIntent('can you make me a form')

console.log(
  JSON.stringify(
    {
      ms,
      text: text.slice(0, 160),
      tools,
      a2uiTypes,
      okForm,
      okHiIntent,
    },
    null,
    2,
  ),
)

if (!okForm || !okHiIntent) {
  console.error('VERIFY_FAIL')
  process.exit(1)
}
console.log('VERIFY_OK')
