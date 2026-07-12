import { describe, expect, test } from 'bun:test'
import { restoreCoworkTaskFromEvents } from '../src/cowork/persist'

describe('restoreCoworkTaskFromEvents', () => {
  test('restores goal, deliverableType, and inputFiles from COWORK_STARTED jsonb payload', () => {
    const task = restoreCoworkTaskFromEvents(
      't-1',
      'sess-1',
      [
        {
          eventType: 'COWORK_STARTED',
          payload: {
            taskId: 't-1',
            goal: 'Build a PDF brief',
            deliverableType: 'pdf',
            inputFiles: [{ sourcePath: 'notes/a.txt' }, 'notes/b.txt'],
            autoApprove: true,
          },
          createdAt: '2026-07-11T10:00:00.000Z',
        },
        {
          eventType: 'COWORK_FINISHED',
          payload: {
            taskId: 't-1',
            status: 'done',
            ok: true,
            files: ['outbox/t-1/report.pdf'],
            summary: 'Done',
          },
          createdAt: '2026-07-11T10:05:00.000Z',
        },
      ],
    )

    expect(task.goal).toBe('Build a PDF brief')
    expect(task.deliverableType).toBe('pdf')
    expect(task.inputFiles).toEqual(['notes/a.txt', 'notes/b.txt'])
    expect(task.status).toBe('done')
    expect(task.files).toEqual(['outbox/t-1/report.pdf'])
    expect(task.summary).toBe('Done')
    expect(task.sessionId).toBe('sess-1')
    expect(task.createdAt).toBe('2026-07-11T10:00:00.000Z')
    expect(task.finishedAt).toBe('2026-07-11T10:05:00.000Z')
  })

  test('legacy STARTED without inputFiles key yields null inputFiles', () => {
    const task = restoreCoworkTaskFromEvents(
      't-legacy',
      'sess-legacy',
      [
        {
          eventType: 'COWORK_STARTED',
          payload: { taskId: 't-legacy', goal: 'Old', deliverableType: 'pdf' },
          createdAt: '2026-07-11T09:00:00.000Z',
        },
        {
          eventType: 'COWORK_FINISHED',
          payload: {
            taskId: 't-legacy',
            status: 'done',
            ok: true,
            files: ['outbox/t-legacy/out.pdf'],
          },
          createdAt: '2026-07-11T09:01:00.000Z',
        },
      ],
    )

    expect(task.inputFiles).toBeNull()
    expect(task.files).toEqual(['outbox/t-legacy/out.pdf'])
  })

  test('STARTED without FINISHED is interrupted failure', () => {
    const task = restoreCoworkTaskFromEvents(
      't-2',
      'sess-2',
      [
        {
          eventType: 'COWORK_STARTED',
          payload: { taskId: 't-2', goal: 'Halfway', deliverableType: 'word' },
          createdAt: '2026-07-11T11:00:00.000Z',
        },
      ],
      { sessionUpdatedAt: '2026-07-11T11:01:00.000Z' },
    )

    expect(task.goal).toBe('Halfway')
    expect(task.deliverableType).toBe('word')
    expect(task.status).toBe('failed')
    expect(task.error).toBe('Interrupted by server restart')
  })
})
