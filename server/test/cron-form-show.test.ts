import { describe, expect, test } from 'bun:test'
import { HERMES_CATALOG_IDS } from '@hermes/shared'
import {
  buildCronFormA2UIPayload,
  isValidCronFormPayload,
  looksLikeCronIntent,
  shouldAutoShowCronForm,
} from '../src/agent/tools/a2ui'
import { getTool } from '../src/agent/tools/registry'
import '../src/agent/tools/a2ui'

describe('cron_form_show A2UI payload', () => {
  test('buildCronFormA2UIPayload matches hermes:CronSchedulePicker catalog shape', () => {
    const payload = buildCronFormA2UIPayload()
    expect(HERMES_CATALOG_IDS).toContain(payload.component.type)
    expect(isValidCronFormPayload(payload)).toBe(true)
    expect(payload.component.type).toBe('hermes:CronSchedulePicker')
    expect(payload.component.props.schedule).toBeTruthy()
    expect(payload.complete).toBe(true)
  })

  test('prefills optional fields', () => {
    const payload = buildCronFormA2UIPayload({
      name: 'Digest',
      schedule: '0 */2 * * *',
      timezone: 'America/New_York',
      prompt: 'Summarize',
    })
    expect(isValidCronFormPayload(payload)).toBe(true)
    expect(payload.component.props.name).toBe('Digest')
    expect(payload.component.props.schedule).toBe('0 */2 * * *')
    expect(payload.component.props.timezone).toBe('America/New_York')
    expect(payload.component.props.prompt).toBe('Summarize')
  })

  test('rejects invalid catalog payloads', () => {
    expect(isValidCronFormPayload(null)).toBe(false)
    expect(isValidCronFormPayload({ component: { type: 'Text', props: {} } })).toBe(false)
    expect(
      isValidCronFormPayload({
        component: { id: 'x', type: 'hermes:CronSchedulePicker', props: { schedule: '' } },
      }),
    ).toBe(false)
  })

  test('cron_form_show tool emits a2ui.message with valid payload', async () => {
    const tool = getTool('cron_form_show')
    expect(tool).toBeDefined()
    const result = (await tool!.execute(
      {},
      {
        sessionId: 's1',
        runId: 'r1',
        signal: new AbortController().signal,
      },
    )) as {
      customEvent: { name: string; value: unknown }
    }
    expect(result.customEvent.name).toBe('a2ui.message')
    expect(isValidCronFormPayload(result.customEvent.value)).toBe(true)
  })

  test('shouldAutoShowCronForm triggers on vague requests only', () => {
    expect(shouldAutoShowCronForm('add a cron job')).toBe(true)
    expect(shouldAutoShowCronForm('schedule a recurring job')).toBe(true)
    expect(shouldAutoShowCronForm('add a scheduled task')).toBe(true)
    expect(shouldAutoShowCronForm('create a scheduled task')).toBe(true)
    expect(shouldAutoShowCronForm('every 2 hours run health check on prod')).toBe(false)
    expect(shouldAutoShowCronForm('what is the weather')).toBe(false)
    expect(shouldAutoShowCronForm('hi')).toBe(false)
    expect(shouldAutoShowCronForm('hello')).toBe(false)
    expect(shouldAutoShowCronForm('how are you')).toBe(false)
    expect(shouldAutoShowCronForm('hey!')).toBe(false)
    expect(shouldAutoShowCronForm('good morning')).toBe(false)
  })

  test('looksLikeCronIntent rejects greetings and accepts clear schedule asks', () => {
    expect(looksLikeCronIntent('hi')).toBe(false)
    expect(looksLikeCronIntent('hello')).toBe(false)
    expect(looksLikeCronIntent('how are you')).toBe(false)
    expect(looksLikeCronIntent('add a cron job')).toBe(true)
    expect(looksLikeCronIntent('list my cron jobs')).toBe(true)
    expect(looksLikeCronIntent('schedule something')).toBe(true)
  })
})
