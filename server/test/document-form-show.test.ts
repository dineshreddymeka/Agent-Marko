import { describe, expect, test } from 'bun:test'
import { HERMES_CATALOG_IDS } from '@hermes/shared'
import {
  buildDocumentFormA2UIPayload,
  buildDocumentFormFromUserText,
  isValidDocumentFormPayload,
  shouldAutoShowDocumentForm,
} from '../src/agent/tools/a2ui'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/a2ui'

describe('document_form_show A2UI payload', () => {
  test('buildDocumentFormA2UIPayload matches hermes:DocumentRequestForm catalog shape', () => {
    const payload = buildDocumentFormA2UIPayload()
    expect(HERMES_CATALOG_IDS).toContain(payload.component.type)
    expect(isValidDocumentFormPayload(payload)).toBe(true)
    expect(payload.component.type).toBe('hermes:DocumentRequestForm')
    expect(payload.complete).toBe(true)
  })

  test('prefills optional fields', () => {
    const payload = buildDocumentFormA2UIPayload({
      deliverableType: 'presentation',
      topic: 'jnj',
      audience: 'execs',
      length: '8 slides',
      style: 'concise',
      notes: 'Q3 focus',
    })
    expect(isValidDocumentFormPayload(payload)).toBe(true)
    expect(payload.component.props.deliverableType).toBe('presentation')
    expect(payload.component.props.topic).toBe('jnj')
    expect(payload.component.props.audience).toBe('execs')
    expect(payload.component.props.length).toBe('8 slides')
  })

  test('buildDocumentFormFromUserText prefills ppt on jnj', () => {
    const payload = buildDocumentFormFromUserText('create a powerpoint on jnj')
    expect(isValidDocumentFormPayload(payload)).toBe(true)
    expect(payload.component.props.deliverableType).toBe('presentation')
    expect(payload.component.props.topic).toBe('jnj')
  })

  test('buildDocumentFormFromUserText leaves topic empty for for me', () => {
    const payload = buildDocumentFormFromUserText('can you create a document for me?')
    expect(isValidDocumentFormPayload(payload)).toBe(true)
    expect(payload.component.props.topic).toBe('')
    expect(payload.component.props.deliverableType).toBe('')
  })

  test('rejects invalid catalog payloads', () => {
    expect(isValidDocumentFormPayload(null)).toBe(false)
    expect(isValidDocumentFormPayload({ component: { type: 'Text', props: {} } })).toBe(false)
    expect(
      isValidDocumentFormPayload({
        component: {
          id: 'x',
          type: 'hermes:DocumentRequestForm',
          props: { deliverableType: 'xlsx' },
        },
      }),
    ).toBe(false)
  })

  test('document_form_show tool emits a2ui.message with valid payload', async () => {
    const tool = getTool('document_form_show')
    expect(tool).toBeDefined()
    const result = (await tool!.execute(
      { deliverableType: 'presentation', topic: 'jnj' },
      {
        sessionId: 's1',
        runId: 'r1',
        signal: new AbortController().signal,
      },
    )) as {
      customEvent: { name: string; value: unknown }
    }
    expect(result.customEvent.name).toBe('a2ui.message')
    expect(isValidDocumentFormPayload(result.customEvent.value)).toBe(true)
    const value = result.customEvent.value as {
      component: { props: { topic?: string; deliverableType?: string } }
    }
    expect(value.component.props.topic).toBe('jnj')
    expect(value.component.props.deliverableType).toBe('presentation')
  })

  test('shouldAutoShowDocumentForm triggers on vague ppt/doc asks', () => {
    expect(shouldAutoShowDocumentForm('i need a ppt')).toBe(true)
    expect(shouldAutoShowDocumentForm('add a cron job')).toBe(false)
    expect(shouldAutoShowDocumentForm('hi')).toBe(false)
  })
})
