import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { config } from '../../config'
import { ToolError } from '../../errors'
import { resolveInsideRoot } from '../../fs/path-jail'
import { registerTool } from './registry'

function workspaceRoot(): string {
  return config.WORKSPACE_ROOT
}

function jailPath(relative: string): string {
  try {
    return resolveInsideRoot(workspaceRoot(), relative)
  } catch {
    throw new ToolError('Path escapes workspace root')
  }
}

registerTool({
  name: 'read_file',
  description: 'Read a file from the workspace',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  async execute(args) {
    const content = await readFile(jailPath(String(args.path)), 'utf8')
    return { content }
  },
})

registerTool({
  name: 'write_file',
  description:
    'Write content to a workspace file under WORKSPACE_ROOT. Use for drafts/work files ' +
    '(e.g. drafts/jnj-draft.md). Call this when the user asks to create/save a document or draft.',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  async execute(args, ctx) {
    const path = jailPath(String(args.path))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, String(args.content), 'utf8')
    void import('../../indexer/service')
      .then(({ queueWorkspaceFile }) =>
        queueWorkspaceFile(String(args.path), { sessionId: ctx.sessionId, runId: ctx.runId }),
      )
      .catch(() => undefined)
    return { ok: true, path: String(args.path) }
  },
})

registerTool({
  name: 'list_dir',
  description: 'List files in a workspace directory',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', default: '.' } },
  },
  async execute(args) {
    const path = jailPath(String(args.path ?? '.'))
    const entries = await readdir(path, { withFileTypes: true })
    return {
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: join(String(args.path ?? '.'), e.name),
      })),
    }
  },
})
