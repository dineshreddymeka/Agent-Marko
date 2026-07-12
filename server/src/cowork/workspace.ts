import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Subdirs required under an Open Cowork shared workspace (§2). */
export const WORKSPACE_SUBDIRS = [
  'inbox',
  'outbox',
  'artifacts',
  'logs',
  'skills',
  'state',
] as const

const JARVIS_BRIDGE_SKILL = `---
name: jarvis-bridge
description: Conventions for tasks delegated by Jarvis. Use this skill whenever the prompt mentions Jarvis, a taskId like t-YYYYMMDD-NNN, or inbox/outbox paths. Defines where to read inputs, where to write outputs, and the required status.json completion contract.
---

# Jarvis Bridge

You are running as a worker for an orchestrator called Jarvis. Every Jarvis task
has a task ID (e.g. \`t-20260711-001\`) and follows this contract.

## Input contract

- All inputs are under \`inbox/<taskId>/\` relative to the workspace root.
- Always read \`inbox/<taskId>/brief.md\` first. It states the goal, the expected
  deliverables, and any constraints.
- Treat \`inbox/\` as read-only. Never write or delete files there.

## Output contract

- Write every deliverable to \`outbox/<taskId>/\`.
- Use predictable names stated in the brief (e.g. \`summary.pptx\`, \`report.docx\`).
- Intermediate/scratch files go in \`artifacts/\`, never in \`outbox/\`.
- Do not modify anything outside this workspace.

## Completion contract (MANDATORY)

As your final action, write \`outbox/<taskId>/status.json\`:

    {
      "taskId": "t-20260711-001",
      "ok": true,
      "files": ["summary.pptx"],
      "summary": "One-paragraph description of what was produced.",
      "warnings": [],
      "startedAt": "2026-07-11T22:00:00Z",
      "finishedAt": "2026-07-11T22:04:31Z"
    }

- \`ok: false\` plus an \`"error"\` string field if you could not complete the task.
  Still list any partial \`files\` you produced.
- Jarvis treats a missing or malformed status.json as task failure.

## Progress + questions (MCP Jarvis tools)

When an MCP server named "Jarvis" is available, use its tools:

- On long tasks, call \`jarvis_report_progress\` with the taskId and a short
  message at meaningful milestones (optionally \`percent\` 0-100) so the
  orchestrator UI can show live progress.
- If something is ambiguous, call \`jarvis_ask\` with the taskId and your
  question, then continue with your best assumption — the ack is immediate
  and no answer will arrive during the task. State the assumption in the
  deliverable.
- \`jarvis_fetch_context\` fetches short Jarvis settings/memory snippets
  (read-only) when the brief references stored context.

If the Jarvis MCP server is not configured, skip these calls silently.

## Style

- Prefer built-in document skills (pptx, docx, xlsx, pdf) for Office outputs.
- Keep responses concise; the file outputs are the deliverable, not the chat text.
`

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure the shared Open Cowork workspace layout exists.
 * Seeds `skills/jarvis-bridge/SKILL.md` when missing.
 */
export async function ensureDirs(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true })
  for (const sub of WORKSPACE_SUBDIRS) {
    await mkdir(join(workspaceRoot, sub), { recursive: true })
  }
  await seedJarvisBridgeSkill(workspaceRoot)
}

/** Path to repo-shipped jarvis-bridge skill (hermes-ui/skills/...). */
export function bundledJarvisBridgeSkillPath(): string {
  // server/src/cowork -> ../../../skills/jarvis-bridge/SKILL.md
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', 'skills', 'jarvis-bridge', 'SKILL.md')
}

async function seedJarvisBridgeSkill(workspaceRoot: string): Promise<void> {
  const dest = join(workspaceRoot, 'skills', 'jarvis-bridge', 'SKILL.md')
  if (await exists(dest)) return

  await mkdir(dirname(dest), { recursive: true })
  const bundled = bundledJarvisBridgeSkillPath()
  if (await exists(bundled)) {
    await copyFile(bundled, dest)
    return
  }
  await writeFile(dest, JARVIS_BRIDGE_SKILL, 'utf8')
}
