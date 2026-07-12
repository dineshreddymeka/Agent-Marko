import { resolve } from 'node:path'
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
  name: 'run_shell',
  description: 'Run a shell command in the workspace directory',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Relative working directory within workspace' },
    },
    required: ['command'],
  },
  async execute(args, ctx) {
    const cwd = args.cwd ? jailPath(String(args.cwd)) : workspaceRoot()
    const proc = Bun.spawn(['bash', '-lc', String(args.command)], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      signal: ctx.signal,
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  },
})
