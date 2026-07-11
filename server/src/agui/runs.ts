import { EventType, type RunAgentInput } from '@ag-ui/core'
import { logger } from '../log'

export type ActiveRun = {
  runId: string
  threadId: string
  controller: AbortController
  startedAt: Date
}

const activeRuns = new Map<string, ActiveRun>()

export function registerRun(input: RunAgentInput): ActiveRun {
  const controller = new AbortController()
  const run: ActiveRun = {
    runId: input.runId,
    threadId: input.threadId,
    controller,
    startedAt: new Date(),
  }
  activeRuns.set(input.runId, run)
  logger.debug('Run registered', { runId: input.runId, threadId: input.threadId })
  return run
}

export function getRun(runId: string): ActiveRun | undefined {
  return activeRuns.get(runId)
}

export function cancelRun(runId: string): boolean {
  const run = activeRuns.get(runId)
  if (!run) return false
  run.controller.abort()
  activeRuns.delete(runId)
  logger.info('Run cancelled', { runId })
  return true
}

export function finishRun(runId: string): void {
  activeRuns.delete(runId)
}

export function listActiveRuns(): ActiveRun[] {
  return [...activeRuns.values()]
}

export function emitRunStarted(input: RunAgentInput, emit: (event: { type: EventType; [k: string]: unknown }) => void) {
  emit({
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
  })
}

export function emitRunFinished(
  input: RunAgentInput,
  emit: (event: { type: EventType; [k: string]: unknown }) => void,
  result?: unknown,
) {
  emit({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    result,
  })
}

export function emitRunError(
  input: RunAgentInput,
  emit: (event: { type: EventType; [k: string]: unknown }) => void,
  message: string,
  code?: string,
) {
  emit({
    type: EventType.RUN_ERROR,
    threadId: input.threadId,
    runId: input.runId,
    message,
    code,
  })
}
