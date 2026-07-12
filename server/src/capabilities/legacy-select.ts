/**
 * Legacy regex tool subsetting — used when HERMES_ROUTING=legacy.
 */
import type { LlmTool } from '../agent/llm'
import { looksLikeCronIntent } from '../agent/tools/a2ui'
import { looksLikeDocumentIntent, prefersCoworkDocument } from '../agent/document-intent'
import { looksLikeFormIntent } from '../agent/form-intent'
import { toLlmTools } from '../agent/tools/registry'

const CRON_TOOL_NAMES = new Set([
  'cron_form_show',
  'cron_create',
  'cron_list',
  'cron_delete',
])

const FORM_TOOL_NAMES = new Set(['form_request_show'])

const DOCUMENT_FOCUS_TOOLS = new Set([
  'document_form_show',
  'write_file',
  'read_file',
  'list_dir',
  'delegate_to_cowork',
  'web_search',
  'fetch_url',
  'memory_search',
  'memory_save',
  'skill_search',
  'index_search',
  'a2ui_render',
])

const FORM_FOCUS_TOOLS = new Set([
  'form_request_show',
  'a2ui_render',
  'write_file',
  'memory_save',
  'memory_search',
])

export function selectLlmToolsLegacy(lastUserText: string): LlmTool[] {
  const all = toLlmTools()
  if (looksLikeCronIntent(lastUserText)) {
    return all.filter((t) => !FORM_TOOL_NAMES.has(t.function.name))
  }
  const withoutCron = all.filter((t) => !CRON_TOOL_NAMES.has(t.function.name))
  if (looksLikeFormIntent(lastUserText)) {
    const focused = withoutCron.filter(
      (t) => FORM_FOCUS_TOOLS.has(t.function.name) || t.function.name.startsWith('mcp:'),
    )
    return focused.map((t) => {
      if (t.function.name === 'form_request_show') {
        return {
          ...t,
          function: {
            ...t.function,
            description:
              'REQUIRED for vague "make/create/build a form" asks. Show the interactive form-request builder — never greet or ask what they want help with.',
          },
        }
      }
      return t
    })
  }
  const withoutCronOrForm = withoutCron.filter((t) => !FORM_TOOL_NAMES.has(t.function.name))
  if (!looksLikeDocumentIntent(lastUserText)) {
    return withoutCronOrForm
  }
  const focused = withoutCronOrForm.filter(
    (t) => DOCUMENT_FOCUS_TOOLS.has(t.function.name) || t.function.name.startsWith('mcp:'),
  )
  const priority = [
    'document_form_show',
    'write_file',
    'delegate_to_cowork',
    'read_file',
    'list_dir',
    'web_search',
  ]
  const sorted = [...focused].sort((a, b) => {
    const ai = priority.indexOf(a.function.name)
    const bi = priority.indexOf(b.function.name)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  return sorted.map((t) => {
    if (t.function.name === 'document_form_show') {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'REQUIRED when topic/audience/length/deliverable type are missing. Show the interactive document/PPT form — never ask clarifying questions in plain text.',
        },
      }
    }
    if (t.function.name === 'write_file') {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'REQUIRED for clear workspace markdown drafts with a known topic. Write drafts/<topic>-draft.md — do not invent topics from "for me". If topic unclear, call document_form_show instead.',
        },
      }
    }
    if (t.function.name === 'delegate_to_cowork' && prefersCoworkDocument(lastUserText)) {
      return {
        ...t,
        function: {
          ...t.function,
          description:
            'For fully specified PDF/Word/PPT requests only. If audience/length/style are missing, call document_form_show instead of asking in text.',
        },
      }
    }
    return t
  })
}
