import { RunAgentInputSchema, type BaseEvent } from '@ag-ui/core'
import { resolveProvider } from '../agent/provider'
import { sessionsRepo } from '../db/repositories/sessions'
import { runEventsRepo } from '../db/repositories/run_events'
import { isHermesError } from '../errors'
import { isDebugChannel, logger } from '../log'
import { isDatabaseAvailable } from '../rest/db-guard'
import { bufferRunEvent } from './run-event-buffer'
import { encodeAguiComment, encodeAguiEvent } from './encoder'
import { createEventRecorder, type EventEmitter } from './events'
import {
  cancelRun,
  emitRunError,
  emitRunFinished,
  emitRunStarted,
  finishRun,
  registerRun,
} from './runs'

let seqCounter = 0

async function recordEvent(runId: string, sessionId: string | null, event: BaseEvent): Promise<void> {
  const seq = ++seqCounter
  if (!(await isDatabaseAvailable())) {
    bufferRunEvent({ runId, sessionId, seq, eventType: event.type, payload: event })
    return
  }
  try {
    await runEventsRepo.append({
      runId,
      sessionId,
      seq,
      eventType: event.type,
      payload: event,
    })
  } catch (err) {
    logger.warn('Failed to record run event', { runId, error: String(err) })
  }
}

export async function handleAguiRequest(req: Request): Promise<Response> {
  const body = await req.json()
  const parsed = RunAgentInputSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  const run = registerRun(input)
  const log = logger.child({ threadId: input.threadId, runId: input.runId })
  const messageCount = Array.isArray(input.messages) ? input.messages.length : 0
  log.info('AG-UI run accepted', {
    messageCount,
    tools: Array.isArray(input.tools) ? input.tools.length : 0,
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk))
      const started = performance.now()
      let eventCount = 0
      const eventTypes = new Map<string, number>()

      write(encodeAguiComment('connected'))

      // Ensure session row exists before any run_events insert (FK run_events_session_fk).
      if (await isDatabaseAvailable()) {
        void sessionsRepo.ensure(input.threadId).catch((err) => {
          log.warn('Failed to ensure session before run events', { error: String(err) })
        })
      }

      const sseEmit: EventEmitter = createEventRecorder((event) => {
        eventCount += 1
        eventTypes.set(event.type, (eventTypes.get(event.type) ?? 0) + 1)
        if (isDebugChannel('agui')) {
          log.debug('AG-UI event', { eventType: event.type, seq: eventCount })
        }
        write(encodeAguiEvent(event))
      }, (event) => {
        void recordEvent(input.runId, input.threadId, event)
      })

      let terminalEmitted = false
      try {
        emitRunStarted(input, sseEmit as EventEmitter)
        const provider = await resolveProvider(input)
        log.info('AG-UI provider resolved', { provider: provider.id })
        await provider.run(input, sseEmit, run.controller.signal)
        if (run.controller.signal.aborted) {
          // Provider returned after abort without throwing. HttpAgent injects
          // RUN_ERROR on fetch abort — do not emit RUN_FINISHED with open frames.
          log.info('Run aborted', {
            durationMs: Math.round(performance.now() - started),
            eventCount,
          })
          terminalEmitted = true
        } else {
          emitRunFinished(input, sseEmit as EventEmitter)
          terminalEmitted = true
          log.info('AG-UI run finished', {
            durationMs: Math.round(performance.now() - started),
            eventCount,
            eventTypes: Object.fromEntries(eventTypes),
          })
        }
      } catch (err) {
        if (run.controller.signal.aborted) {
          log.info('Run aborted', {
            durationMs: Math.round(performance.now() - started),
            eventCount,
          })
          terminalEmitted = true
        } else {
          const message = isHermesError(err) ? err.message : String(err)
          const code = isHermesError(err) ? err.code : 'PROVIDER_ERROR'
          log.error('Run failed', {
            error: err,
            code,
            durationMs: Math.round(performance.now() - started),
            eventCount,
          })
          emitRunError(input, sseEmit as EventEmitter, message, code)
          terminalEmitted = true
        }
      } finally {
        if (!terminalEmitted) {
          try {
            emitRunFinished(input, sseEmit as EventEmitter)
          } catch {
            /* best-effort */
          }
        }
        finishRun(input.runId)
        controller.close()
      }
    },
    cancel() {
      log.info('AG-UI client cancelled stream')
      cancelRun(input.runId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export async function handleAguiCancel(_req: Request, runId: string): Promise<Response> {
  const ok = cancelRun(runId)
  if (!ok) {
    return Response.json({ error: 'Run not found' }, { status: 404 })
  }
  return Response.json({ ok: true })
}

export function handleAguiOptions(): Response {
  return new Response(null, { status: 204 })
}
