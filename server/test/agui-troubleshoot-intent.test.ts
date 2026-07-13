import { describe, expect, test } from 'bun:test'
import { looksLikeAguiTroubleshootIntent } from '../src/agent/agui-troubleshoot-intent'

describe('agui troubleshoot intent', () => {
  test('matches explicit AGUI/A2UI troubleshooting asks', () => {
    expect(looksLikeAguiTroubleshootIntent('help me troubleshoot AGUI chat not rendering')).toBe(
      true,
    )
    expect(looksLikeAguiTroubleshootIntent('debug a2ui integration issues')).toBe(true)
    expect(looksLikeAguiTroubleshootIntent('agui/a2ui troubleshooting report')).toBe(true)
    expect(looksLikeAguiTroubleshootIntent('what are common AG-UI SSE errors?')).toBe(true)
    expect(looksLikeAguiTroubleshootIntent('A2UI surface is blank — fix?')).toBe(true)
  })

  test('rejects greetings and unrelated chat', () => {
    expect(looksLikeAguiTroubleshootIntent('hi')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('hello')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('what is the weather')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('create a powerpoint on jnj')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('can you make me a form')).toBe(false)
  })

  test('rejects protocol mention without troubleshoot intent', () => {
    expect(looksLikeAguiTroubleshootIntent('what is AG-UI?')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('explain a2ui to me')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('render a2ui surface for booking')).toBe(false)
  })

  test('rejects troubleshoot language without AGUI/A2UI context', () => {
    expect(looksLikeAguiTroubleshootIntent('debug my postgres connection')).toBe(false)
    expect(looksLikeAguiTroubleshootIntent('fix the login page')).toBe(false)
  })
})
