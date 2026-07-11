import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { config } from '../../config'
import { ToolError } from '../../errors'
import { registerTool } from './registry'

function workspaceRoot(): string {
  return resolve(process.cwd(), config.WORKSPACE_ROOT)
}

function jailPath(relative: string): string {
  const root = workspaceRoot()
  const full = resolve(root, relative)
  if (!full.startsWith(root)) {
    throw new ToolError('Path escapes workspace root')
  }
  return full
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
  description: 'Write content to a workspace file',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const path = jailPath(String(args.path))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, String(args.content), 'utf8')
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
