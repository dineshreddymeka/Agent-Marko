/** Custom AG-UI event names and payload types (Phase 3+) */

export const HermesCustomEvents = {
  CONTEXT: 'hermes.context',
  CRON_FIRED: 'hermes.cron.fired',
  SKILL_LEARNED: 'hermes.skill.learned',
  TITLE: 'hermes.title',
  A2UI_MESSAGE: 'a2ui.message',
  APPROVAL_REQUIRED: 'hermes.approval.required',
} as const

export type HermesCustomEventName =
  | typeof HermesCustomEvents.CONTEXT
  | typeof HermesCustomEvents.CRON_FIRED
  | typeof HermesCustomEvents.SKILL_LEARNED
  | typeof HermesCustomEvents.TITLE
  | typeof HermesCustomEvents.A2UI_MESSAGE
  | typeof HermesCustomEvents.APPROVAL_REQUIRED

export interface HermesContextPayload {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  tokensUsed?: number
  tokensMax?: number
  contextLimit?: number
}

export interface HermesTitlePayload {
  sessionId?: string
  title: string
}

export interface HermesCronFiredPayload {
  jobId: string
  jobName: string
}

export interface HermesSkillLearnedPayload {
  skillId: string
  skillName: string
}

export interface HermesApprovalRequiredPayload {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export type HermesCustomPayload =
  | HermesContextPayload
  | HermesTitlePayload
  | HermesCronFiredPayload
  | HermesSkillLearnedPayload
  | HermesApprovalRequiredPayload
  | Record<string, unknown>

export interface HermesCustomEvent {
  name: HermesCustomEventName
  payload: HermesCustomPayload
}
