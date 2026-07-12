import { EventType, type RunAgentInput } from '@ag-ui/core'
import { logger } from '../log'

export type ActiveRun = {
  runId: string
  threadId: string
  controller: AbortController
  startedAt: Date
  /** Parent run id when this is a nested `delegate_to_agent` sub-run. */
  parentRunId?: string | null
  /** Provider id for delegated nested runs. */
  provider?: string | null
  kind?: 'root' | 'delegated'
}

export type DelegationRecord = {
  parentRunId: string
  nestedRunId: string
  provider: string
  threadId: string
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'finished' | 'error'
  error: string | null
}

const activeRuns = new Map<string, ActiveRun>()
const MAX_RECENT_DELEGATIONS = 50
const recentDelegations: DelegationRecord[] = []

export function registerRun(
  input: RunAgentInput,
  opts?: { parentRunId?: string | null; provider?: string | null; kind?: ActiveRun['kind'] },
): ActiveRun {
  const controller = new AbortController()
  const run: ActiveRun = {
    runId: input.runId,
    threadId: input.threadId,
    controller,
    startedAt: new Date(),
    parentRunId: opts?.parentRunId ?? null,
    provider: opts?.provider ?? null,
    kind: opts?.kind ?? (opts?.parentRunId ? 'delegated' : 'root'),
  }
  activeRuns.set(input.runId, run)
  logger.debug('Run registered', {
    runId: input.runId,
    threadId: input.threadId,
    parentRunId: run.parentRunId,
    kind: run.kind,
  })
  return run
}

export function beginDelegation(input: {
  parentRunId: string
  nestedRunId: string
  provider: string
  threadId: string
}): DelegationRecord {
  const record: DelegationRecord = {
    parentRunId: input.parentRunId,
    nestedRunId: input.nestedRunId,
    provider: input.provider,
    threadId: input.threadId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    error: null,
  }
  recentDelegations.unshift(record)
  if (recentDelegations.length > MAX_RECENT_DELEGATIONS) {
    recentDelegations.length = MAX_RECENT_DELEGATIONS
  }
  return record
}

export function finishDelegation(
  nestedRunId: string,
  status: 'finished' | 'error',
  error?: string | null,
): DelegationRecord | null {
  const record = recentDelegations.find((d) => d.nestedRunId === nestedRunId)
  if (!record) return null
  record.status = status
  record.finishedAt = new Date().toISOString()
  record.error = error ?? null
  return record
}

export function listRecentDelegations(limit = 20): DelegationRecord[] {
  return recentDelegations.slice(0, Math.min(Math.max(limit, 1), MAX_RECENT_DELEGATIONS))
}

export function resetDelegationsForTests(): void {
  recentDelegations.length = 0
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
