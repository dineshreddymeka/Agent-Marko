/**
 * Composer / small-model bridges sometimes put meta-planning into `content`
 * instead of `reasoning_content` ("Preparing to respond… Drafting…").
 * Split those prefixes into thinking so the user-facing reply stays clean.
 */
const PLANNING_PREFIX =
  /^(?:(?:Preparing to (?:respond|reply|answer|help)[^.!\n]*[.!]?\s*)|(?:Drafting (?:a |an |the )?[^.!\n]*[.!]?\s*)|(?:Planning (?:to |a |my |the )?[^.!\n]*[.!]?\s*)|(?:Thinking (?:about |through )?[^.!\n]*[.!]?\s*)|(?:Considering (?:how |what |a )?[^.!\n]*[.!]?\s*))+/i

export function splitLeakedPlanning(text: string): {
  thinkingExtra: string
  content: string
} {
  const raw = text ?? ''
  if (!raw.trim()) return { thinkingExtra: '', content: raw }

  let rest = raw
  let thinkingExtra = ''
  // Peel repeated planning sentences from the start only.
  for (let i = 0; i < 8; i++) {
    const m = rest.match(PLANNING_PREFIX)
    if (!m?.[0]) break
    thinkingExtra += m[0]
    rest = rest.slice(m[0].length)
  }
  return {
    thinkingExtra: thinkingExtra.trim(),
    content: thinkingExtra ? rest.replace(/^\s+/, '') : raw,
  }
}
