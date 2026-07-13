import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { config } from '../config'
import { isPathInsideRoot } from '../fs/path-jail'
import { buildTaskPrompt } from './prompt'
import { ensureDirs } from './workspace'

export { isPathInsideRoot } from '../fs/path-jail'

/**
 * Resolve a source file for inbox packaging. Only paths under Hermes
 * WORKSPACE_ROOT, OPEN_COWORK_WORKSPACE, or the active task workspaceRoot
 * are allowed (SCA / path-jail).
 */
export function resolveAllowedSourcePath(
  sourcePath: string,
  workspaceRoot?: string,
): string {
  const raw = sourcePath.trim()
  if (!raw) throw new Error('Source path is empty')

  const hermesRoot = config.WORKSPACE_ROOT
  const coworkRoot = resolve(config.OPEN_COWORK_WORKSPACE)
  const allowedRoots = [hermesRoot, coworkRoot]
  if (workspaceRoot) allowedRoots.push(resolve(workspaceRoot))

  const candidates = [
    resolve(raw),
    resolve(hermesRoot, raw),
    resolve(coworkRoot, raw),
    ...(workspaceRoot ? [resolve(workspaceRoot, raw)] : []),
  ]
  for (const candidate of candidates) {
    if (allowedRoots.some((root) => isPathInsideRoot(root, candidate))) {
      return candidate
    }
  }
  throw new Error(`Source path escapes allowed workspace roots: ${sourcePath}`)
}

export type PackageFileInput = {
  /** Absolute or caller-resolved path of the source file to copy into inbox. */
  sourcePath: string
  /** Optional name inside inbox/<taskId>/ (defaults to basename of sourcePath). */
  name?: string
}

export type PackagedTask = {
  taskId: string
  prompt: string
  /** Workspace-relative path to the brief. */
  briefPath: string
  /** Workspace-relative paths of copied input files (excluding brief.md). */
  inputFiles: string[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Generate a task id like `t-20260711-001` (UTC date + random 3-digit suffix). */
export function generateTaskId(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = pad2(now.getUTCMonth() + 1)
  const d = pad2(now.getUTCDate())
  const seq = String(Math.floor(Math.random() * 900) + 100) // 100–999
  return `t-${y}${m}${d}-${seq}`
}

/**
 * Package a task into the shared workspace data plane:
 * writes `inbox/<taskId>/brief.md`, copies optional input files, returns prompt.
 */
export async function packageTask(
  workspaceRoot: string,
  instruction: string,
  files?: PackageFileInput[],
  opts?: { taskId?: string },
): Promise<PackagedTask> {
  await ensureDirs(workspaceRoot)

  const taskId = opts?.taskId ?? generateTaskId()
  const inboxDir = join(workspaceRoot, 'inbox', taskId)
  await mkdir(inboxDir, { recursive: true })
  // Ensure outbox task dir exists for Cowork to write into
  await mkdir(join(workspaceRoot, 'outbox', taskId), { recursive: true })

  const inputFiles: string[] = []
  const assetLines: string[] = []

  if (files?.length) {
    for (const file of files) {
      const name = file.name?.trim() || basename(file.sourcePath)
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        throw new Error(`Invalid inbox file name: ${name}`)
      }
      const source = resolveAllowedSourcePath(file.sourcePath, workspaceRoot)
      const dest = join(inboxDir, name)
      await copyFile(source, dest)
      const rel = `inbox/${taskId}/${name}`
      inputFiles.push(rel)
      assetLines.push(`- ${rel}`)
    }
  }

  const briefBody = [
    `# Task ${taskId}`,
    '',
    '## Goal',
    '',
    instruction.trim(),
    '',
    '## Deliverables',
    '',
    `Write outputs under \`outbox/${taskId}/\` with predictable names stated by the goal.`,
    `Finish by writing \`outbox/${taskId}/status.json\` per the jarvis-bridge skill.`,
    '',
    ...(assetLines.length
      ? ['## Input files', '', ...assetLines, '']
      : ['## Input files', '', '_None beyond this brief._', '']),
    '## Constraints',
    '',
    '- Treat `inbox/` as read-only.',
    '- Do not modify files outside the workspace.',
    '- Prefer built-in document skills for Office outputs.',
    '',
  ].join('\n')

  await writeFile(join(inboxDir, 'brief.md'), briefBody, 'utf8')

  const briefPath = `inbox/${taskId}/brief.md`
  const prompt = buildTaskPrompt(taskId, instruction)

  return { taskId, prompt, briefPath, inputFiles }
}
