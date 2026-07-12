/** Short greetings / chitchat that must never trip form intent. */
const CASUAL_GREETING =
  /^(hi|hello|hey|howdy|yo|sup|hiya|good\s+(morning|afternoon|evening)|how\s+are\s+you|how's\s+it\s+going|whats?\s+up)[!?.\s]*$/i

/**
 * True when the user wants a generic interactive form (not cron, not doc/PPT).
 * Document/PPT/Office asks stay on document_form_show.
 */
export function looksLikeFormIntent(userText: string): boolean {
  const text = userText.trim()
  if (!text || CASUAL_GREETING.test(text)) return false
  // Document / Office / PPT deliverables take precedence.
  if (
    /\b(ppt|pptx|powerpoint|slides?|slide\s*deck|decks?|presentations?|pdfs?|docx?|word(?:\s+docs?)?|work\s*files?|markdown|md\s+files?)\b/i.test(
      text,
    )
  ) {
    return false
  }
  if (
    /\b(create|write|draft|make|prepare|save|generate|produce)\b[\s\S]{0,96}\b(documents?|reports?|memos?|briefs?)\b/i.test(
      text,
    )
  ) {
    return false
  }
  // Cron / scheduled-task asks are handled elsewhere.
  if (/\b(cron|recurring|scheduled?\s+tasks?|scheduled?\s+jobs?)\b/i.test(text)) {
    return false
  }
  return (
    /\b(make|create|build|design|show|render|generate|need|want)\b[\s\S]{0,64}\b(a\s+|an\s+|the\s+|me\s+(a\s+|an\s+)?)?forms?\b/i.test(
      text,
    ) ||
    /\bforms?\b[\s\S]{0,40}\b(builder|for\s+me|please|with\s+fields)\b/i.test(text) ||
    /\b(i\s+)?(need|want)\s+(a\s+|an\s+|the\s+)?forms?\b/i.test(text)
  )
}

/** Vague generic form asks → show interactive A2UI form-request surface. */
export function shouldAutoShowFormRequest(userText: string): boolean {
  return looksLikeFormIntent(userText)
}
