import { EventType } from '@ag-ui/core'
import { HermesCustomEvents } from '@hermes/shared'
import { registerTool } from './registry'

registerTool({
  name: 'a2ui_render',
  description: 'Render an A2UI surface in the chat transcript',
  parameters: {
    type: 'object',
    properties: {
      payload: { type: 'object', description: 'A2UI JSONL message payload' },
    },
    required: ['payload'],
  },
  async execute(args, ctx) {
    return {
      customEvent: {
        type: EventType.CUSTOM,
        name: HermesCustomEvents.A2UI_MESSAGE,
        value: args.payload,
      },
      sessionId: ctx.sessionId,
      runId: ctx.runId,
    }
  },
})
