import { describe, expect, test } from 'bun:test'
import {
  looksLikeFormIntent,
  shouldAutoShowFormRequest,
} from '../src/agent/form-intent'
import { splitLeakedPlanning } from '../src/agent/response-sanitize'

describe('form intent routing', () => {
  test('looksLikeFormIntent accepts make/create/build a form', () => {
    expect(looksLikeFormIntent('can you make me a form')).toBe(true)
    expect(looksLikeFormIntent('create a form')).toBe(true)
    expect(looksLikeFormIntent('build a form')).toBe(true)
    expect(looksLikeFormIntent('make a form for feedback')).toBe(true)
    expect(looksLikeFormIntent('i need a form')).toBe(true)
    expect(looksLikeFormIntent('design a form with fields')).toBe(true)
  })

  test('looksLikeFormIntent rejects greetings and document/PPT/cron', () => {
    expect(looksLikeFormIntent('hi')).toBe(false)
    expect(looksLikeFormIntent('hello')).toBe(false)
    expect(looksLikeFormIntent('create a powerpoint on jnj')).toBe(false)
    expect(looksLikeFormIntent('i need a ppt')).toBe(false)
    expect(looksLikeFormIntent('can you create a document for me?')).toBe(false)
    expect(looksLikeFormIntent('create a PDF about jnj')).toBe(false)
    expect(looksLikeFormIntent('add a cron job')).toBe(false)
    expect(looksLikeFormIntent('what is the weather')).toBe(false)
  })

  test('shouldAutoShowFormRequest mirrors form intent', () => {
    expect(shouldAutoShowFormRequest('can you make me a form')).toBe(true)
    expect(shouldAutoShowFormRequest('hi')).toBe(false)
    expect(shouldAutoShowFormRequest('make a slide deck')).toBe(false)
  })
})

describe('splitLeakedPlanning', () => {
  test('peels Preparing/Drafting prefixes into thinkingExtra', () => {
    const raw =
      "Preparing to respond as Open Jarvis. Drafting a brief, friendly greeting in chat. Hi — I'm Open Jarvis. What can I help you with today?"
    const { thinkingExtra, content } = splitLeakedPlanning(raw)
    expect(thinkingExtra).toContain('Preparing to respond')
    expect(thinkingExtra).toContain('Drafting a brief')
    expect(content).toMatch(/^Hi/)
    expect(content).not.toContain('Preparing to respond')
    expect(content).not.toContain('Drafting a brief')
  })

  test('leaves normal replies untouched', () => {
    const raw = "Hi — I'm Open Jarvis. What can I help you with today?"
    const { thinkingExtra, content } = splitLeakedPlanning(raw)
    expect(thinkingExtra).toBe('')
    expect(content).toBe(raw)
  })
})
