import type { BaseEvent } from '@ag-ui/core'

export function encodeAguiEvent(event: BaseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function encodeAguiComment(comment: string): string {
  return `: ${comment}\n\n`
}

export function encodeAguiDone(): string {
  return `data: [DONE]\n\n`
}
