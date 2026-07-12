/**
 * Chat tool: run a packaged Open Cowork headless task and stream progress into AG-UI.
 */
import { EventType } from '@ag-ui/core'
import { HermesCustomEvents, type CoworkDeliverableType } from '@hermes/shared'
import { registerTool } from './registry'
import { generateTaskId } from '../../cowork/task'
import { runCoworkTask } from '../../cowork/run-task'
import {
  createDeltaThrottler,
  mapCoworkEventToProgress,
} from '../../cowork/chat-progress'

const DELIVERABLE_TYPES = [
  'presentation',
  'word',
  'spreadsheet',
  'pdf',
  'other',
] as const satisfies readonly CoworkDeliverableType[]

function isDeliverableType(v: unknown): v is CoworkDeliverableType {
  return typeof v === 'string' && (DELIVERABLE_TYPES as readonly string[]).includes(v)
}

registerTool({
  name: 'delegate_to_cowork',
  description:
    'Delegate a document/office deliverable to Open Cowork (headless). Use for PDF, Word, PowerPoint, spreadsheet, or other file generation under the Cowork outbox.',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'What to produce (topic, audience, constraints).',
      },
      deliverableType: {
        type: 'string',
        enum: [...DELIVERABLE_TYPES],
        description: 'Primary deliverable format.',
      },
      autoApprove: {
        type: 'boolean',
        description: 'Pass --auto-approve to Open Cowork when supported.',
      },
    },
    required: ['goal', 'deliverableType'],
  },
  async execute(args, ctx) {
    const goal = String(args.goal ?? '').trim()
    if (!goal) throw new Error('goal is required')
    if (!isDeliverableType(args.deliverableType)) {
      throw new Error(
        `deliverableType must be one of: ${DELIVERABLE_TYPES.join(', ')}`,
      )
    }

    const taskId = generateTaskId()
    const emit = ctx.emit
    let coworkSessionId: string | null = null

    const emitProgress = async (
      payload: ReturnType<typeof mapCoworkEventToProgress>,
    ) => {
      if (!payload || !emit) return
      await emit({
        type: EventType.CUSTOM,
        name: HermesCustomEvents.COWORK_PROGRESS,
        value: payload,
      })
    }

    const delta = createDeltaThrottler((text) => {
      void emitProgress({
        taskId,
        coworkSessionId,
        phase: 'delta',
        text,
      })
    })

    const onAbort = () => {
      // runCoworkTask honors signal; progress error is emitted on catch below.
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    try {
      const result = await runCoworkTask({
        goal,
        deliverableType: args.deliverableType,
        autoApprove:
          typeof args.autoApprove === 'boolean' ? args.autoApprove : undefined,
        taskId,
        parentSessionId: ctx.sessionId,
        signal: ctx.signal,
        onEvent: (evt) => {
          if (evt.type === 'session.started' && typeof evt.sessionId === 'string') {
            coworkSessionId = evt.sessionId
          }
          const mapped = mapCoworkEventToProgress(evt, { taskId, coworkSessionId })
          if (!mapped) return
          if (mapped.phase === 'delta' && mapped.text) {
            delta.push(mapped.text)
            return
          }
          delta.flushNow()
          void emitProgress(mapped)
        },
      })

      delta.flushNow()

      return {
        taskId: result.taskId,
        ok: result.ok,
        status: result.status,
        statusJson: result.statusJson,
        files: result.files,
        summary: result.summary,
        validationError: result.validationError,
        coworkSessionId: result.coworkSessionId,
        sessionId: result.sessionId,
        parentSessionId: ctx.sessionId,
        resultText: result.resultText,
        deliverableType: result.deliverableType,
        goal: result.goal,
      }
    } catch (err) {
      delta.flushNow()
      const message = err instanceof Error ? err.message : String(err)
      await emitProgress({
        taskId,
        coworkSessionId,
        phase: 'error',
        text: message,
        ok: false,
      })
      throw err
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }
  },
})
