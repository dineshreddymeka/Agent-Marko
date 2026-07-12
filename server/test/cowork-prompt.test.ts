import { describe, expect, test } from 'bun:test'
import { buildTaskPrompt } from '../src/cowork/prompt'

describe('buildTaskPrompt', () => {
  test('includes taskId and relative inbox/outbox paths', () => {
    const taskId = 't-20260711-001'
    const prompt = buildTaskPrompt(taskId, 'Produce summary.pptx from the brief.')

    expect(prompt).toContain(taskId)
    expect(prompt).toContain(`inbox/${taskId}/`)
    expect(prompt).toContain(`inbox/${taskId}/brief.md`)
    expect(prompt).toContain(`outbox/${taskId}/`)
    expect(prompt).toContain(`outbox/${taskId}/status.json`)
    expect(prompt).toContain('Produce summary.pptx from the brief.')
    expect(prompt).toContain('jarvis-bridge')
  })

  test('does not embed absolute Windows paths in workspace-relative parts', () => {
    const prompt = buildTaskPrompt('t-20260711-042', 'Write hello.txt')

    expect(prompt).not.toMatch(/[A-Za-z]:\\/)
    expect(prompt).not.toMatch(/[A-Za-z]:\//)
    expect(prompt).not.toContain('C:\\')
    expect(prompt).not.toContain('C:/Users')
    expect(prompt).not.toContain('jarvis-cowork-workspace')
  })
})
