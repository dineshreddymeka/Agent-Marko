import { describe, expect, test } from 'bun:test'
import { HERMES_CATALOG_IDS } from '@hermes/shared'
import {
  buildFormRequestA2UIPayload,
  isValidFormRequestPayload,
  shouldAutoShowFormRequest,
} from '../src/agent/tools/a2ui'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/a2ui'

describe('form_request_show A2UI payload', () => {
  test('buildFormRequestA2UIPayload matches hermes:FormRequestForm catalog shape', () => {
    const payload = buildFormRequestA2UIPayload()
    expect(HERMES_CATALOG_IDS).toContain(payload.component.type)
    expect(isValidFormRequestPayload(payload)).toBe(true)
    expect(payload.component.type).toBe('hermes:FormRequestForm')
    expect(payload.complete).toBe(true)
  })

  test('prefills optional fields', () => {
    const payload = buildFormRequestA2UIPayload({
      purpose: 'Feedback',
      fields: 'name, email, rating',
      submitAction: 'email team',
      storageTarget: 'workspace',
    })
    expect(isValidFormRequestPayload(payload)).toBe(true)
    expect(payload.component.props.purpose).toBe('Feedback')
    expect(payload.component.props.fields).toBe('name, email, rating')
    expect(payload.component.props.storageTarget).toBe('workspace')
  })

  test('rejects invalid catalog payloads', () => {
    expect(isValidFormRequestPayload(null)).toBe(false)
    expect(isValidFormRequestPayload({ component: { type: 'Text', props: {} } })).toBe(false)
  })

  test('shouldAutoShowFormRequest for make me a form', () => {
    expect(shouldAutoShowFormRequest('can you make me a form')).toBe(true)
    expect(shouldAutoShowFormRequest('hi')).toBe(false)
  })

  test('form_request_show tool emits a2ui.message with valid payload', async () => {
    const tool = getTool('form_request_show')
    expect(tool).toBeDefined()
    const result = (await tool!.execute(
      { purpose: 'Intake' },
      {
        sessionId: 's1',
        runId: 'r1',
        signal: new AbortController().signal,
      },
    )) as {
      customEvent: { name: string; value: unknown }
    }
    expect(result.customEvent.name).toBe('a2ui.message')
    expect(isValidFormRequestPayload(result.customEvent.value)).toBe(true)
    const value = result.customEvent.value as {
      component: { props: { purpose: string } }
    }
    expect(value.component.props.purpose).toBe('Intake')
  })
})
