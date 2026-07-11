import { registerTool } from './registry'
import { runCodeInSandbox } from '../../compute/pool'

registerTool({
  name: 'run_code',
  description: 'Execute JavaScript/TypeScript in a sandboxed subprocess',
  dangerous: true,
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      language: { type: 'string', enum: ['javascript', 'typescript'] },
    },
    required: ['code'],
  },
  async execute(args, ctx) {
    return runCodeInSandbox(String(args.code), ctx.signal)
  },
})
