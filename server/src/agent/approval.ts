import { EventType } from '@ag-ui/core'
import { ApprovalRejectedError, ApprovalTimeoutError } from '../errors'
import type { EventEmitter } from '../agui/events'
import { settingsRepo } from '../db/repositories/settings'

export type ApprovalDecision = 'approve' | 'reject' | 'always' | 'always_tool'

export const APPROVAL_SETTING_KEYS = {
  autoApproveAll: 'approval.autoApproveAll',
  toolWhitelist: 'approval.toolWhitelist',
  sessionWhitelist: 'approval.sessionWhitelist',
} as const

type PendingApproval = {
  resolve: (decision: ApprovalDecision) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  sessionId: string
  toolName: string
}

const pending = new Map<string, PendingApproval>()

let autoApproveAll = false
let toolWhitelist = new Set<string>()
let sessionAlwaysAllow = new Set<string>()

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export interface ApprovalConfig {
  autoApproveAll: boolean
  toolWhitelist: string[]
  sessionWhitelist: string[]
}

export function getApprovalConfig(): ApprovalConfig {
  return {
    autoApproveAll,
    toolWhitelist: [...toolWhitelist],
    sessionWhitelist: [...sessionAlwaysAllow],
  }
}

export async function loadApprovalSettings(envAutoApprove = false): Promise<void> {
  try {
    const storedAuto = await settingsRepo.get(APPROVAL_SETTING_KEYS.autoApproveAll)
    autoApproveAll = envAutoApprove || Boolean(storedAuto)

    const tools = await settingsRepo.get(APPROVAL_SETTING_KEYS.toolWhitelist)
    toolWhitelist = new Set(
      Array.isArray(tools) ? tools.filter((t): t is string => typeof t === 'string') : [],
    )

    const sessions = await settingsRepo.get(APPROVAL_SETTING_KEYS.sessionWhitelist)
    sessionAlwaysAllow = new Set(
      Array.isArray(sessions) ? sessions.filter((s): s is string => typeof s === 'string') : [],
    )
  } catch {
    autoApproveAll = envAutoApprove
    toolWhitelist = new Set()
    sessionAlwaysAllow = new Set()
  }
}

export async function updateApprovalConfig(
  patch: Partial<Pick<ApprovalConfig, 'autoApproveAll' | 'toolWhitelist'>>,
): Promise<ApprovalConfig> {
  if (patch.autoApproveAll !== undefined) {
    autoApproveAll = patch.autoApproveAll
    await settingsRepo.set(APPROVAL_SETTING_KEYS.autoApproveAll, autoApproveAll)
  }
  if (patch.toolWhitelist !== undefined) {
    toolWhitelist = new Set(patch.toolWhitelist)
    await settingsRepo.set(APPROVAL_SETTING_KEYS.toolWhitelist, [...toolWhitelist])
  }
  return getApprovalConfig()
}

export function isSessionWhitelisted(sessionId: string): boolean {
  return sessionAlwaysAllow.has(sessionId)
}

export function isToolWhitelisted(toolName: string): boolean {
  return toolWhitelist.has(toolName)
}

export function shouldAutoApprove(sessionId: string, toolName: string, dangerous: boolean): boolean {
  if (!dangerous) return true
  return autoApproveAll || isSessionWhitelisted(sessionId) || isToolWhitelisted(toolName)
}

export async function whitelistSession(sessionId: string): Promise<void> {
  sessionAlwaysAllow.add(sessionId)
  await settingsRepo.set(APPROVAL_SETTING_KEYS.sessionWhitelist, [...sessionAlwaysAllow])
}

export async function whitelistTool(toolName: string): Promise<void> {
  toolWhitelist.add(toolName)
  await settingsRepo.set(APPROVAL_SETTING_KEYS.toolWhitelist, [...toolWhitelist])
}

export async function removeToolFromWhitelist(toolName: string): Promise<void> {
  toolWhitelist.delete(toolName)
  await settingsRepo.set(APPROVAL_SETTING_KEYS.toolWhitelist, [...toolWhitelist])
}

export async function requestApproval(opts: {
  sessionId: string
  runId: string
  toolCallId: string
  toolName: string
  args: unknown
  emit: EventEmitter
  dangerous: boolean
}): Promise<ApprovalDecision> {
  if (shouldAutoApprove(opts.sessionId, opts.toolName, opts.dangerous)) {
    return 'approve'
  }

  return new Promise<ApprovalDecision>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(opts.toolCallId)
      reject(new ApprovalTimeoutError('Approval timed out'))
    }, APPROVAL_TIMEOUT_MS)

    pending.set(opts.toolCallId, {
      resolve,
      reject,
      timer,
      sessionId: opts.sessionId,
      toolName: opts.toolName,
    })

    void opts.emit({
      type: EventType.CUSTOM,
      name: 'hermes.approval.required',
      value: {
        toolCallId: opts.toolCallId,
        toolName: opts.toolName,
        args: opts.args,
      },
    })
  })
}

export function resolveApproval(toolCallId: string, decision: ApprovalDecision): boolean {
  const entry = pending.get(toolCallId)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(toolCallId)

  if (decision === 'reject') {
    entry.reject(new ApprovalRejectedError('Tool call rejected by user'))
    return true
  }

  if (decision === 'always') {
    void whitelistSession(entry.sessionId)
    entry.resolve('approve')
    return true
  }

  if (decision === 'always_tool') {
    void whitelistTool(entry.toolName)
    entry.resolve('approve')
    return true
  }

  entry.resolve(decision)
  return true
}
