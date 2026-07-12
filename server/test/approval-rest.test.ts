import { describe, expect, test, beforeEach } from 'bun:test'
import { handleApproval } from '../src/rest/approval'
import { resolveApproval } from '../src/agent/approval'

describe('approval REST path matching', () => {
  beforeEach(async () => {
    const { loadApprovalSettings } = await import('../src/agent/approval')
    await loadApprovalSettings(false)
  })

  test('GET /api/approval/config uses parts[2] (length 3)', async () => {
    const res = await handleApproval(
      new Request('http://127.0.0.1/api/approval/config'),
      '/api/approval/config',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = (await res!.json()) as {
      autoApproveAll: boolean
      toolWhitelist: string[]
      sessionWhitelist: string[]
    }
    expect(body).toHaveProperty('autoApproveAll')
    expect(Array.isArray(body.toolWhitelist)).toBe(true)
    expect(Array.isArray(body.sessionWhitelist)).toBe(true)
  })

  test('PUT /api/approval/config routes (invalid JSON → 400 before DB)', async () => {
    const res = await handleApproval(
      new Request('http://127.0.0.1/api/approval/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
      '/api/approval/config',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
  })

  test('POST /api/approval/resolve works for pending toolCallId', async () => {
    const { requestApproval } = await import('../src/agent/approval')
    const pending = requestApproval({
      sessionId: 'sess-rest',
      runId: 'run-rest',
      toolCallId: 'tc-rest-1',
      toolName: 'run_shell',
      args: {},
      emit: async () => {},
      dangerous: true,
    })

    const res = await handleApproval(
      new Request('http://127.0.0.1/api/approval/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolCallId: 'tc-rest-1', decision: 'approve' }),
      }),
      '/api/approval/resolve',
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    expect(await res!.json()).toEqual({ ok: true })
    await expect(pending).resolves.toBe('approve')
  })

  test('legacy wrong path parts[1]===config does not match length-2', async () => {
    // /api/approval alone must not be treated as config
    const res = await handleApproval(
      new Request('http://127.0.0.1/api/approval'),
      '/api/approval',
    )
    expect(res).toBeNull()
  })

  test('resolve returns 404 for unknown toolCallId', async () => {
    expect(resolveApproval('missing-rest', 'approve')).toBe(false)
    const res = await handleApproval(
      new Request('http://127.0.0.1/api/approval/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolCallId: 'missing-rest', decision: 'approve' }),
      }),
      '/api/approval/resolve',
    )
    expect(res!.status).toBe(404)
  })
})
