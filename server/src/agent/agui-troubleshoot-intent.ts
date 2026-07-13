/** Short greetings / chitchat that must never trip AGUI/A2UI troubleshoot intent. */
const CASUAL_GREETING =
  /^(hi|hello|hey|howdy|yo|sup|hiya|good\s+(morning|afternoon|evening)|how\s+are\s+you|how's\s+it\s+going|whats?\s+up)[!?.\s]*$/i

/** User mentions AG-UI, A2UI, or closely related generative/agent UI protocols. */
const PROTOCOL_TERMS =
  /\b(ag-?ui|a2ui|agui\/a2ui|a2ui\/agui|agent[\s-]user interaction|generative ui|agent[\s-]driven ui|agent ui protocol)\b/i

/** Explicit troubleshooting / diagnostic language (not generic "help me"). */
const TROUBLESHOOT_TERMS =
  /\b(troubleshoot(?:ing)?|debug(?:ging)?|diagnos(?:e|is|ing)|fix(?:ing)?|issue?s?|problem?s?|not working|doesn't work|does not work|broken|error?s?|fail(?:ed|ing|ure)?|stall(?:ed|ing)?|blank|empty|white screen|hang(?:s|ing)?|mismatch|integration pitfall|known issue|top\s+\d+|common issue|why (?:is|are|does|do)|can't|cannot)\b/i

/** Shorthand explicit asks that skip the dual-keyword requirement. */
const EXPLICIT_ASK =
  /\b(agui|a2ui|ag-?ui)\s*(?:\/\s*(?:agui|a2ui|ag-?ui))?\s*(?:troubleshoot(?:ing)?|debug(?:ging)?|issues? report|top\s+\d+)\b/i

/**
 * True when the user explicitly asks for AGUI/A2UI troubleshooting help.
 * Normal chat, greetings, and unrelated tasks must not match.
 */
export function looksLikeAguiTroubleshootIntent(userText: string): boolean {
  const text = userText.trim()
  if (!text || CASUAL_GREETING.test(text)) return false
  if (EXPLICIT_ASK.test(text)) return true
  return PROTOCOL_TERMS.test(text) && TROUBLESHOOT_TERMS.test(text)
}
