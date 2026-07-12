import type { DocumentRequestDeliverableType } from '@hermes/shared'

/** Short greetings / chitchat that must never trip document intent. */
const CASUAL_GREETING =
  /^(hi|hello|hey|howdy|yo|sup|hiya|good\s+(morning|afternoon|evening)|how\s+are\s+you|how's\s+it\s+going|whats?\s+up)[!?.\s]*$/i

/** Pronouns / filler that must never become draft topics ("document for me" → not "me"). */
const TOPIC_STOPWORDS =
  /^(me|us|you|myself|yourself|themselves|someone|anyone|everyone|somebody|anybody|it|this|that|them|him|her|one)$/i

/**
 * True when the user wants a PPT / slides / deck / presentation.
 * These must never auto-write markdown stubs.
 */
export function looksLikePresentationIntent(userText: string): boolean {
  const text = userText.trim()
  if (!text || CASUAL_GREETING.test(text)) return false
  return /\b(ppt|pptx|powerpoint|slides?|slide\s*deck|decks?|presentations?)\b/i.test(text)
}

/**
 * True when the user is asking to create/draft/save a document, work file,
 * PDF/Word/PPT, report, etc. Greetings and unrelated chat return false.
 */
export function looksLikeDocumentIntent(userText: string): boolean {
  const text = userText.trim()
  if (!text || CASUAL_GREETING.test(text)) return false
  if (looksLikePresentationIntent(text)) return true
  return (
    /\b(create|write|draft|make|prepare|save|generate|produce|need|want)\b[\s\S]{0,96}\b(work\s*files?|documents?|drafts?|pdfs?|docx?|word(?:\s+docs?)?|markdown|md\s+files?|reports?|memos?|briefs?|notes?|ppt|pptx|powerpoint|slides?|decks?|presentations?)\b/i.test(
      text,
    ) ||
    /\b(work\s*files?|documents?|drafts?)\b[\s\S]{0,48}\b(about|on|regarding|for)\b/i.test(text) ||
    /\b(draft|write)\s+(a\s+|an\s+|the\s+)?(doc|document|file|report|memo|brief|note)s?\b/i.test(
      text,
    ) ||
    /\b(pdf|docx?|word|ppt|pptx|powerpoint|slides?|deck)\b[\s\S]{0,48}\b(about|on|regarding|for)\b/i.test(
      text,
    ) ||
    /\b(i\s+)?(need|want|create)\s+(a\s+|an\s+|the\s+)?(document|doc|draft|ppt|pptx|powerpoint|presentation|deck|pdf|word)\b/i.test(
      text,
    )
  )
}

/** Office binary deliverables — prefer Open Cowork over a markdown workspace file. */
export function prefersCoworkDocument(userText: string): boolean {
  return /\b(pdfs?|docx?|word(?:\s+docs?)?|powerpoint|pptx|ppt|slides?|decks?|presentations?|excel|xlsx|office\s+docs?)\b/i.test(
    userText.trim(),
  )
}

/**
 * Infer form deliverable type from user text, or null when unclear.
 */
export function inferDeliverableType(
  userText: string,
): DocumentRequestDeliverableType | null {
  const text = userText.trim()
  if (looksLikePresentationIntent(text)) return 'presentation'
  if (/\b(pdfs?)\b/i.test(text)) return 'pdf'
  if (/\b(docx?|word(?:\s+docs?)?)\b/i.test(text)) return 'word'
  if (
    /\b(markdown|md\s+files?|work\s*files?|drafts?)\b/i.test(text) ||
    /\b(draft|write)\s+(a\s+|an\s+|the\s+)?(doc|document|file|report|memo|brief|note)s?\b/i.test(
      text,
    )
  ) {
    return 'markdown'
  }
  if (/\bdocuments?\b/i.test(text)) return null
  return null
}

/**
 * Extract a short topic for draft filenames / titles.
 * Returns null when no about/on/regarding/for clause is present,
 * or when the match is a pronoun filler ("for me").
 */
export function extractDocumentTopic(userText: string): string | null {
  const text = userText.trim()
  // Prefer explicit topic prepositions; avoid treating "for me" as a topic.
  const patterns = [
    /\b(?:about|regarding)\s+(.+?)(?:\s+[—\-–]\s+|\s*\(|[.!?]|$)/i,
    /\bon\s+(.+?)(?:\s+[—\-–]\s+|\s*\(|[.!?]|$)/i,
    /\bfor\s+(.+?)(?:\s+[—\-–]\s+|\s*\(|[.!?]|$)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (!m?.[1]) continue
    const topic = m[1].replace(/\s+/g, ' ').trim()
    if (!topic || topic.length < 1) continue
    if (TOPIC_STOPWORDS.test(topic)) continue
    // "for me a document" style leftovers — first word stopword
    const first = topic.split(/\s+/)[0] ?? ''
    if (TOPIC_STOPWORDS.test(first) && topic.split(/\s+/).length <= 2) continue
    return topic.slice(0, 80)
  }
  return null
}

export function slugifyTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'draft'
}

/**
 * Vague document/PPT asks → show interactive A2UI form (like cron_form_show).
 * Clear markdown drafts with a real topic still use the write_file interceptor.
 */
export function shouldAutoShowDocumentForm(userText: string): boolean {
  const text = userText.trim()
  if (!looksLikeDocumentIntent(text)) return false
  // PPT / Office → always surface the form (prefill topic/type when known).
  if (looksLikePresentationIntent(text) || prefersCoworkDocument(text)) return true
  const topic = extractDocumentTopic(text)
  // No usable topic → form (never invent "me" stubs).
  if (!topic) return true
  // Deliverable type unclear (bare "document") → form so user picks markdown/word/pdf/ppt.
  if (inferDeliverableType(text) == null) return true
  return false
}

/**
 * Deterministic workspace draft for clear create/draft/work-file asks.
 * Skips Office/PPT formats and unclear topics (those use the A2UI form).
 */
export function shouldAutoCreateDocumentDraft(userText: string): boolean {
  const text = userText.trim()
  if (!looksLikeDocumentIntent(text)) return false
  if (shouldAutoShowDocumentForm(text)) return false
  if (prefersCoworkDocument(text)) return false
  const topic = extractDocumentTopic(text)
  if (!topic) return false
  return /\b(create|write|draft|make|prepare|save|generate)\b[\s\S]{0,64}\b(work\s*files?|drafts?|documents?|markdown|md\s+files?|reports?|memos?|briefs?|notes?)\b/i.test(
    text,
  )
}

export function buildDocumentDraftMarkdown(topic: string, userText = ''): string {
  const title = topic.trim() || 'Untitled draft'
  return [
    `# Draft: ${title}`,
    '',
    '## Overview',
    '',
    `Working draft about **${title}**.`,
    '',
    '## Key points',
    '',
    `- Topic: ${title}`,
    `- Request: ${userText.trim() || '(unspecified)'}`,
    '- Status: initial draft — expand sections as needed',
    '',
    '## Outline',
    '',
    '1. Background',
    '2. Main points',
    '3. Open questions',
    '4. Next steps',
    '',
    '## Notes',
    '',
    '_Replace this stub with researched content. Ask Open Jarvis to expand any section._',
    '',
  ].join('\n')
}

export function documentDraftPath(topic: string): string {
  return `drafts/${slugifyTopic(topic || 'draft')}-draft.md`
}

/** Empty / non-committal assistant replies that should never be the only answer to a concrete task. */
export function looksLikeEmptyAcknowledgment(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return true
  if (t.length > 160) return false
  return (
    (/^(sure|okay|ok|understood|got it|alright|right)[.!]?\s*/i.test(t) &&
      /\b(what (would|do) you (like|want|need)|how can i help|how may i help|what can i (do|help))\b/i.test(
        t,
      )) ||
    /^(what (would|do) you (like|want|need)(\s+help\s+with)?\??|how can i help( you)?\??|how may i assist( you)?\??)\s*$/i.test(
      t,
    )
  )
}
