import { describe, expect, test } from 'bun:test'
import { JsonlLineBuffer, parseJsonlLine } from '../src/cowork/jsonl'

describe('parseJsonlLine', () => {
  test('skips blank and whitespace-only lines', () => {
    expect(parseJsonlLine('')).toEqual({ ok: false, reason: 'blank', line: '' })
    expect(parseJsonlLine('   \t  ')).toEqual({ ok: false, reason: 'blank', line: '   \t  ' })
    expect(parseJsonlLine('\n')).toEqual({ ok: false, reason: 'blank', line: '\n' })
  })

  test('parses valid Cowork events', () => {
    const r = parseJsonlLine('{"type":"stdio.ready"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ type: 'stdio.ready' })

    const r2 = parseJsonlLine('  {"type":"session.started","sessionId":"s1"}  ')
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.value.type).toBe('session.started')
      expect(r2.value.sessionId).toBe('s1')
    }
  })

  test('skips malformed JSON and non-objects', () => {
    expect(parseJsonlLine('{not json').ok).toBe(false)
    expect(parseJsonlLine('{not json').reason).toBe('malformed')
    expect(parseJsonlLine('"just a string"').reason).toBe('malformed')
    expect(parseJsonlLine('[1,2]').reason).toBe('malformed')
    expect(parseJsonlLine('null').reason).toBe('malformed')
    expect(parseJsonlLine('{"noType":true}').reason).toBe('malformed')
  })
})

describe('JsonlLineBuffer', () => {
  test('buffers partial chunks across pushes', () => {
    const buf = new JsonlLineBuffer()
    expect(buf.push('{"type":"std')).toEqual([])
    expect(buf.remainder()).toBe('{"type":"std')
    expect(buf.push('io.ready"}\n{"type":"session.')).toEqual(['{"type":"stdio.ready"}'])
    expect(buf.push('started","sessionId":"abc"}\n')).toEqual([
      '{"type":"session.started","sessionId":"abc"}',
    ])
    expect(buf.remainder()).toBe('')
  })

  test('handles CRLF and multiple complete lines in one chunk', () => {
    const buf = new JsonlLineBuffer()
    const lines = buf.push('{"type":"a"}\r\n{"type":"b"}\r\n')
    expect(lines).toEqual(['{"type":"a"}', '{"type":"b"}'])
  })

  test('flush returns leftover without clearing semantics incorrectly', () => {
    const buf = new JsonlLineBuffer()
    buf.push('partial')
    expect(buf.flush()).toBe('partial')
    expect(buf.remainder()).toBe('')
  })
})
