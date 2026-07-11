import type { RunAgentInput } from '@ag-ui/core'
import type { AgentProvider } from '../provider'
import type { EventEmitter } from '../../agui/events'
import { runNativeAgent } from '../runtime'

export const nativeProvider: AgentProvider = {
  id: 'native',
  async run(input: RunAgentInput, emit: EventEmitter, signal: AbortSignal) {
    await runNativeAgent(input, emit, signal)
  },
}
