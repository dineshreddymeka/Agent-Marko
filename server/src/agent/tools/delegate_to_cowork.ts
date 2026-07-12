import { EventType } from '@ag-ui/core'
import type { CoworkDeliverableType } from '@hermes/shared'
import { HermesCustomEvents } from '@hermes/shared'
import { ToolError } from '../../errors'
import {
  createDeltaThrottler,
  mapCoworkEventToProgress,
} from '../../cowork/chat-progress'
import {
  runCoworkTask,
  type RunCoworkTaskResult,
} from '../../cowork/run-task'
import { generateTaskId, type PackageFileInput } from '../../cowork/task'
import { registerTool } from './registry'

const DELIVERABLE_TYPES = new Set<CoworkDeliverableType>([
  'presentation',
  'word',
  'spreadsheet',
  'pdf',
  'other',
])

function parseFilesArg(raw: unknown): PackageFileInput[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) {
    throw new ToolError('files must be an array of paths or {sourcePath,name?} objects')
  }
  return raw.map((item, i) => {
    if (typeof item === 'string') {
      return { sourcePath: item }
    }
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { sourcePath?: unknown }).sourcePath === 'string'
    ) {
      const obj = item as { sourcePath: string; name?: string }
      return { sourcePath: obj.sourcePath, name: obj.name }
    }
    throw new ToolError(`files[${i}] must be a string path or { sourcePath, name? }`)
  })
}

function parseDeliverableType(raw: unknown): CoworkDeliverableType | undefined {
  if (raw == null || raw === '') return undefined
  const value = String(raw)
  if (!DELIVERABLE_TYPES.has(value as CoworkDeliverableType)) {
    throw new ToolError(
      `deliverableType must be one of: ${[...DELIVERABLE_TYPES].join(', ')}`,
    )
  }
  return value as CoworkDeliverableType
}

function toToolResult(result: RunCoworkTaskResult) {
  return {
    taskId: result.taskId,
    ok: result.ok,
    status: result.statusJson,
    files: result.files,
    summary: result.summary,
    validationError: result.validationError,
    sessionId: result.coworkSessionId,
    hermesSessionId: result.sessionId,
    resultText: result.resultText,
    eventCount: result.eventCount,
    exitCode: result.exitCode,
    stderrTail: result.stderrTail,
    briefPath: result.briefPath,
    prompt: result.prompt,
  }
}

registerTool({
  name: 'delegate_to_cowork',
  description:
    'Delegate a specialist task to Open Cowork (documents, sandboxed file/shell work). ' +
    'Writes inbox/<taskId>/brief.md, runs a headless Cowork session, streams progress into chat, ' +
    'and returns validated outbox results.',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: 'Task goal and deliverable names for Cowork (written into brief.md)',
      },
      deliverableType: {
        type: 'string',
        enum: [...DELIVERABLE_TYPES],
        description: 'Optional document deliverable chip (presentation/word/spreadsheet/pdf/other)',
      },
      files: {
        type: 'array',
        description:
          'Optional input files to copy into inbox/<taskId>/. Each item is a path string or {sourcePath, name?}.',
        items: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                sourcePath: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['sourcePath'],
            },
          ],
        },
      },
    },
    required: ['instruction'],
  },
  async execute(args, ctx) {
    const instruction = String(args.instruction ?? '').trim()
    if (!instruction) {
      throw new ToolError('instruction is required')
    }

    const files = parseFilesArg(args.files)
    const deliverableType = parseDeliverableType(args.deliverableType)
    const taskId = generateTaskId()
    let coworkSessionId: string | null = null

    const emitProgress = (payload: ReturnType<typeof mapCoworkEventToProgress>) => {
      if (!payload || !ctx.emit) return
      void ctx.emit({
        type: EventType.CUSTOM,
        name: HermesCustomEvents.COWORK_PROGRESS,
        value: payload,
      })
    }

    const delta = createDeltaThrottler((text) => {
      emitProgress({
        taskId,
        coworkSessionId,
        phase: 'delta',
        text,
      })
    })

    try {
      const result = await runCoworkTask({
        goal: instruction,
        files,
        deliverableType,
        taskId,
        signal: ctx.signal,
        onEvent: (evt) => {
          if (evt.type === 'session.started' && typeof evt.sessionId === 'string') {
            coworkSessionId = evt.sessionId
          }
          if (evt.type === 'agent.text_delta') {
            const text = String(evt.text ?? '')
            if (text) delta.push(text)
            return
          }
          // Flush any buffered deltas before non-delta phases so order stays sensible.
          delta.flushNow()
          emitProgress(mapCoworkEventToProgress(evt, { taskId, coworkSessionId }))
        },
      })
      delta.flushNow()
      return toToolResult(result)
    } catch (err) {
      delta.flushNow()
      throw new ToolError(
        err instanceof Error ? err.message : `cowork task failed: ${String(err)}`,
      )
    }
  },
})
