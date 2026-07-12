import type { BaseEvent } from '@ag-ui/core'

/** BaseEvent plus the per-type payload fields (messageId, toolCallId, name, …). */
export type AguiEmittedEvent = BaseEvent & Record<string, unknown>

export type EventEmitter = (event: AguiEmittedEvent) => void | Promise<void>

export function createEventRecorder(emit: EventEmitter, record?: (event: BaseEvent) => void): EventEmitter {
  return (event) => {
    record?.(event)
    return emit(event)
  }
}
