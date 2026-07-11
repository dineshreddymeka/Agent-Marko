import { RunAgentInputSchema, type BaseEvent } from '@ag-ui/core'
import { resolveProvider } from '../agent/provider'
import { runEventsRepo } from '../db/repositories/run_events'
import { isHermesError } from '../errors'
import { logger } from '../log'
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk))

      write(encodeAguiComment('connected'))

      const sseEmit: EventEmitter = createEventRecorder((event) => {
        write(encodeAguiEvent(event))
      }, (event) => {
        void recordEvent(input.runId, input.threadId, event)
      })

      try {
        emitRunStarted(input, sseEmit as EventEmitter)
        const provider = await resolveProvider(input)
        await provider.run(input, sseEmit, run.controller.signal)
        emitRunFinished(input, sseEmit as EventEmitter)
      } catch (err) {
        if (run.controller.signal.aborted) {
          log.info('Run aborted')
        } else {
          const message = isHermesError(err) ? err.message : String(err)
          const code = isHermesError(err) ? err.code : 'PROVIDER_ERROR'
          log.error('Run failed', { error: message, code })
          emitRunError(input, sseEmit as EventEmitter, message, code)
        }
      } finally {
        finishRun(input.runId)
        controller.close()
      }
    },
    cancel() {
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
