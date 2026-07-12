import { EventType } from '@ag-ui/core'
import {
  HermesCustomEvents,
  type DocumentRequestDeliverableType,
  type HermesCatalogComponentId,
} from '@hermes/shared'
import {
  extractDocumentTopic,
  inferDeliverableType,
  shouldAutoShowDocumentForm,
} from '../document-intent'
import { shouldAutoShowFormRequest } from '../form-intent'
import { registerTool } from './registry'

/** Default A2UI surface payload for the interactive cron create form. */
export type CronFormA2UIPayload = {
  surfaceId: string
  component: {
    id: string
    type: HermesCatalogComponentId
    props: {
      name?: string
      schedule: string
      timezone?: string
      prompt?: string
      mcpServerIds?: string[]
      skillIds?: string[]
    }
  }
  complete: boolean
}

/** A2UI surface for document / PPT / Office requests. */
export type DocumentFormA2UIPayload = {
  surfaceId: string
  component: {
    id: string
    type: HermesCatalogComponentId
    props: {
      deliverableType?: DocumentRequestDeliverableType | ''
      topic?: string
      audience?: string
      length?: string
      notes?: string
      style?: string
    }
  }
  complete: boolean
}

/** A2UI surface for generic form-builder requests. */
export type FormRequestA2UIPayload = {
  surfaceId: string
  component: {
    id: string
    type: HermesCatalogComponentId
    props: {
      purpose?: string
      fields?: string
      submitAction?: string
      storageTarget?: string
    }
  }
  complete: boolean
}

/** Build a catalog-valid CronSchedulePicker surface (widget loads MCP/skills live). */
export function buildCronFormA2UIPayload(opts?: {
  name?: string
  schedule?: string
  timezone?: string
  prompt?: string
  mcpServerIds?: string[]
  skillIds?: string[]
  surfaceId?: string
}): CronFormA2UIPayload {
  return {
    surfaceId: opts?.surfaceId ?? `cron-form-${crypto.randomUUID().slice(0, 8)}`,
    component: {
      id: 'cron-picker',
      type: 'hermes:CronSchedulePicker',
      props: {
        name: opts?.name ?? '',
        schedule: opts?.schedule ?? '0 9 * * *',
        timezone: opts?.timezone ?? 'UTC',
        prompt: opts?.prompt ?? '',
        mcpServerIds: opts?.mcpServerIds ?? [],
        skillIds: opts?.skillIds ?? [],
      },
    },
    complete: true,
  }
}

/** Short greetings / chitchat that must never trip cron intent. */
const CASUAL_GREETING =
  /^(hi|hello|hey|howdy|yo|sup|hiya|good\s+(morning|afternoon|evening)|how\s+are\s+you|how's\s+it\s+going|whats?\s+up)[!?.\s]*$/i

/**
 * True when the user is clearly asking about cron / scheduled / recurring tasks.
 * Greetings and unrelated chat must return false.
 */
export function looksLikeCronIntent(userText: string): boolean {
  const text = userText.trim()
  if (!text || CASUAL_GREETING.test(text)) return false
  return (
    /\b(add|create|schedule|set\s*up|setup|make|new|configure|register)\b[\s\S]{0,64}\b(cron|recurring|scheduled?\s+tasks?|scheduled?\s+jobs?)\b/i.test(
      text,
    ) ||
    /\b(cron|recurring)\s+(job|task|schedule)s?\b/i.test(text) ||
    /\bcron\s+jobs?\b/i.test(text) ||
    /\b(schedule|schedul(e|ing))\b[\s\S]{0,40}\b(task|job|something|it|this)\b/i.test(text) ||
    /\b(scheduled|recurring)\s+(task|job)s?\b/i.test(text)
  )
}

/**
 * True when the user wants a cron job but has not fully specified schedule + action.
 * Used for deterministic form rendering on small models that talk instead of calling tools.
 */
export function shouldAutoShowCronForm(userText: string): boolean {
  const text = userText.trim()
  if (!looksLikeCronIntent(text)) return false
  const hasSchedule =
    /\b(?:\*|\d+)(?:\/\d+)?\s+(?:\*|\d+)(?:\/\d+)?\s+(?:\*|\d+)(?:\/\d+)?\s+(?:\*|\d+)(?:\/\d+)?\s+(?:\*|\d+)(?:\/\d+)?\b/.test(
      text,
    ) || /\bevery\s+\d+\s+(minutes?|hours?|days?|weeks?)\b/i.test(text)
  const hasAction =
    /\b(run|execute|do|send|check|summarize|remind|ping|call|invoke)\b/i.test(text) &&
    text.split(/\s+/).length >= 6
  // Fully specified → leave to cron_create / the model.
  if (hasSchedule && hasAction) return false
  return true
}

/** Lightweight catalog-shape check for CronSchedulePicker payloads. */
export function isValidCronFormPayload(payload: unknown): payload is CronFormA2UIPayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as CronFormA2UIPayload
  const c = p.component
  if (!c || typeof c !== 'object') return false
  if (c.type !== 'hermes:CronSchedulePicker') return false
  if (typeof c.id !== 'string' || !c.id) return false
  if (!c.props || typeof c.props !== 'object') return false
  if (typeof c.props.schedule !== 'string' || !c.props.schedule) return false
  if (c.props.timezone != null && typeof c.props.timezone !== 'string') return false
  if (c.props.name != null && typeof c.props.name !== 'string') return false
  if (c.props.prompt != null && typeof c.props.prompt !== 'string') return false
  if (c.props.mcpServerIds != null && !Array.isArray(c.props.mcpServerIds)) return false
  if (c.props.skillIds != null && !Array.isArray(c.props.skillIds)) return false
  return true
}

registerTool({
  name: 'cron_form_show',
  description:
    'REQUIRED for vague cron requests. Immediately show the interactive cron form (name/schedule/timezone/prompt/MCP/skills). Call this as your ONLY action when the user says things like "add a cron job" or "schedule something recurring" without full details. Never ask schedule/timezone/action questions in plain text. Never describe the form without calling this tool. Use cron_create only when name + schedule + prompt are all present.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional prefill for job name' },
      schedule: { type: 'string', description: 'Optional prefill cron expression' },
      timezone: { type: 'string', description: 'Optional prefill IANA timezone' },
      prompt: { type: 'string', description: 'Optional prefill agent prompt' },
    },
  },
  async execute(args, ctx) {
    const payload = buildCronFormA2UIPayload({
      name: args.name != null ? String(args.name) : undefined,
      schedule: args.schedule != null ? String(args.schedule) : undefined,
      timezone: args.timezone != null ? String(args.timezone) : undefined,
      prompt: args.prompt != null ? String(args.prompt) : undefined,
    })
    return {
      customEvent: {
        type: EventType.CUSTOM,
        name: HermesCustomEvents.A2UI_MESSAGE,
        value: payload,
      },
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      ok: true,
    }
  },
})

/** Build a catalog-valid DocumentRequestForm surface. */
export function buildDocumentFormA2UIPayload(opts?: {
  deliverableType?: DocumentRequestDeliverableType | ''
  topic?: string
  audience?: string
  length?: string
  notes?: string
  style?: string
  surfaceId?: string
}): DocumentFormA2UIPayload {
  return {
    surfaceId: opts?.surfaceId ?? `doc-form-${crypto.randomUUID().slice(0, 8)}`,
    component: {
      id: 'document-request',
      type: 'hermes:DocumentRequestForm',
      props: {
        deliverableType: opts?.deliverableType ?? '',
        topic: opts?.topic ?? '',
        audience: opts?.audience ?? '',
        length: opts?.length ?? '',
        notes: opts?.notes ?? '',
        style: opts?.style ?? '',
      },
    },
    complete: true,
  }
}

/** Prefill document form from the latest user message. */
export function buildDocumentFormFromUserText(userText: string): DocumentFormA2UIPayload {
  const topic = extractDocumentTopic(userText) ?? ''
  const deliverableType = inferDeliverableType(userText) ?? ''
  return buildDocumentFormA2UIPayload({
    topic,
    deliverableType,
    notes: userText.trim().slice(0, 240),
  })
}

/** Re-export for runtime interceptor (keeps import path stable). */
export { shouldAutoShowDocumentForm }

/** Lightweight catalog-shape check for DocumentRequestForm payloads. */
export function isValidDocumentFormPayload(
  payload: unknown,
): payload is DocumentFormA2UIPayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as DocumentFormA2UIPayload
  const c = p.component
  if (!c || typeof c !== 'object') return false
  if (c.type !== 'hermes:DocumentRequestForm') return false
  if (typeof c.id !== 'string' || !c.id) return false
  if (!c.props || typeof c.props !== 'object') return false
  const dt = c.props.deliverableType
  if (
    dt != null &&
    dt !== '' &&
    dt !== 'markdown' &&
    dt !== 'word' &&
    dt !== 'pdf' &&
    dt !== 'presentation'
  ) {
    return false
  }
  if (c.props.topic != null && typeof c.props.topic !== 'string') return false
  if (c.props.audience != null && typeof c.props.audience !== 'string') return false
  if (c.props.length != null && typeof c.props.length !== 'string') return false
  if (c.props.notes != null && typeof c.props.notes !== 'string') return false
  if (c.props.style != null && typeof c.props.style !== 'string') return false
  return true
}

registerTool({
  name: 'document_form_show',
  description:
    'REQUIRED for vague document/PPT/Office requests. Immediately show the interactive document request form (deliverable type, topic, audience, length/slides, notes). Call this as your ONLY action when the user says things like "i need a ppt", "create a document for me", or "make a powerpoint" without full details. Never ask Topic/Audience/Length/Style questions in plain text. Never describe the form without calling this tool. Prefill topic/type when the user already named them.',
  parameters: {
    type: 'object',
    properties: {
      deliverableType: {
        type: 'string',
        description: 'Optional prefill: markdown | word | pdf | presentation',
      },
      topic: { type: 'string', description: 'Optional prefill topic/title' },
      audience: { type: 'string', description: 'Optional prefill audience' },
      length: { type: 'string', description: 'Optional prefill length or slide count' },
      notes: { type: 'string', description: 'Optional prefill notes' },
      style: { type: 'string', description: 'Optional prefill style' },
    },
  },
  async execute(args, ctx) {
    const rawType = args.deliverableType != null ? String(args.deliverableType) : ''
    const deliverableType =
      rawType === 'markdown' ||
      rawType === 'word' ||
      rawType === 'pdf' ||
      rawType === 'presentation'
        ? rawType
        : ''
    const payload = buildDocumentFormA2UIPayload({
      deliverableType,
      topic: args.topic != null ? String(args.topic) : undefined,
      audience: args.audience != null ? String(args.audience) : undefined,
      length: args.length != null ? String(args.length) : undefined,
      notes: args.notes != null ? String(args.notes) : undefined,
      style: args.style != null ? String(args.style) : undefined,
    })
    return {
      customEvent: {
        type: EventType.CUSTOM,
        name: HermesCustomEvents.A2UI_MESSAGE,
        value: payload,
      },
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      ok: true,
    }
  },
})

/** Build a catalog-valid FormRequestForm surface. */
export function buildFormRequestA2UIPayload(opts?: {
  purpose?: string
  fields?: string
  submitAction?: string
  storageTarget?: string
  surfaceId?: string
}): FormRequestA2UIPayload {
  return {
    surfaceId: opts?.surfaceId ?? `form-req-${crypto.randomUUID().slice(0, 8)}`,
    component: {
      id: 'form-request',
      type: 'hermes:FormRequestForm',
      props: {
        purpose: opts?.purpose ?? '',
        fields: opts?.fields ?? '',
        submitAction: opts?.submitAction ?? '',
        storageTarget: opts?.storageTarget ?? 'chat',
      },
    },
    complete: true,
  }
}

/** Lightweight catalog-shape check for FormRequestForm payloads. */
export function isValidFormRequestPayload(
  payload: unknown,
): payload is FormRequestA2UIPayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as FormRequestA2UIPayload
  const c = p.component
  if (!c || typeof c !== 'object') return false
  if (c.type !== 'hermes:FormRequestForm') return false
  if (typeof c.id !== 'string' || !c.id) return false
  if (!c.props || typeof c.props !== 'object') return false
  if (c.props.purpose != null && typeof c.props.purpose !== 'string') return false
  if (c.props.fields != null && typeof c.props.fields !== 'string') return false
  if (c.props.submitAction != null && typeof c.props.submitAction !== 'string') return false
  if (c.props.storageTarget != null && typeof c.props.storageTarget !== 'string') return false
  return true
}

/** Re-export for runtime interceptor. */
export { shouldAutoShowFormRequest }

registerTool({
  name: 'form_request_show',
  description:
    'REQUIRED for vague generic form requests (not cron, not documents/PPT). Immediately show the interactive form-request builder (purpose, fields, submit action, storage target). Call this as your ONLY action when the user says things like "make me a form", "create a form", or "build a form" without full details. Never greet again. Never ask "what can I help with". Never ask clarifying questions only in plain text without showing this form.',
  parameters: {
    type: 'object',
    properties: {
      purpose: { type: 'string', description: 'Optional prefill form purpose' },
      fields: { type: 'string', description: 'Optional prefill field list' },
      submitAction: { type: 'string', description: 'Optional prefill submit action' },
      storageTarget: {
        type: 'string',
        description: 'Optional prefill: chat | workspace | memory | other',
      },
    },
  },
  async execute(args, ctx) {
    const rawStorage = args.storageTarget != null ? String(args.storageTarget) : 'chat'
    const storageTarget =
      rawStorage === 'workspace' ||
      rawStorage === 'memory' ||
      rawStorage === 'other' ||
      rawStorage === 'chat'
        ? rawStorage
        : 'chat'
    const payload = buildFormRequestA2UIPayload({
      purpose: args.purpose != null ? String(args.purpose) : undefined,
      fields: args.fields != null ? String(args.fields) : undefined,
      submitAction: args.submitAction != null ? String(args.submitAction) : undefined,
      storageTarget,
    })
    return {
      customEvent: {
        type: EventType.CUSTOM,
        name: HermesCustomEvents.A2UI_MESSAGE,
        value: payload,
      },
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      ok: true,
    }
  },
})

registerTool({
  name: 'a2ui_render',
  description: `Render an A2UI surface in the chat transcript. For cron/scheduled jobs prefer cron_form_show (prebuilt form). For documents/PPT prefer document_form_show. For generic "make me a form" prefer form_request_show. If using this tool for cron, payload must be:
{"surfaceId":"…","component":{"id":"cron-picker","type":"hermes:CronSchedulePicker","props":{"name":"","schedule":"0 9 * * *","timezone":"UTC","prompt":"","mcpServerIds":[],"skillIds":[]}},"complete":true}
The widget loads MCP/skill dropdowns live; user submits create_cron via the form.`,
  parameters: {
    type: 'object',
    properties: {
      payload: { type: 'object', description: 'A2UI JSONL message payload' },
    },
    required: ['payload'],
  },
  async execute(args, ctx) {
    return {
      customEvent: {
        type: EventType.CUSTOM,
        name: HermesCustomEvents.A2UI_MESSAGE,
        value: args.payload,
      },
      sessionId: ctx.sessionId,
      runId: ctx.runId,
    }
  },
})
