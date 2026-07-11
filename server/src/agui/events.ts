import type { BaseEvent } from '@ag-ui/core'

export type EventEmitter = (event: BaseEvent) => void | Promise<void>

export function createEventRecorder(emit: EventEmitter, record?: (event: BaseEvent) => void): EventEmitter {
  return (event) => {
    record?.(event)
    return emit(event)
  }
}
