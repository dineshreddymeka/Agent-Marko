/**
 * Build the Cowork session prompt for a packaged task.
 * Uses workspace-relative paths only — never absolute Windows paths (§2, §4).
 */
export function buildTaskPrompt(taskId: string, instruction: string): string {
  const briefRel = `inbox/${taskId}/brief.md`
  const inboxRel = `inbox/${taskId}/`
  const outboxRel = `outbox/${taskId}/`
  const statusRel = `outbox/${taskId}/status.json`

  return [
    `You are executing task ${taskId} for Jarvis. Follow the jarvis-bridge skill.`,
    `Inputs are in ${inboxRel}. Read ${briefRel} first.`,
    instruction.trim(),
    `Write all deliverables to ${outboxRel}.`,
    `Finish by writing ${statusRel} per the jarvis-bridge skill schema.`,
    `Do not modify files outside this workspace.`,
  ].join('\n')
}
