/**
 * System maintenance cron catalog + identification units.
 */
import { describe, expect, test } from 'bun:test'
import {
  SYSTEM_CRON_JOBS,
  SYSTEM_CRON_SCHEDULE,
  isSystemCronJob,
} from '../src/cron/system-jobs'

describe('system cron jobs', () => {
  test('default schedule is every 5 minutes', () => {
    expect(SYSTEM_CRON_SCHEDULE).toBe('*/5 * * * *')
  })

  test('catalog covers DB Consistency + Bug Bounty', () => {
    expect(SYSTEM_CRON_JOBS.map((j) => j.kind).sort()).toEqual(['bug-bounty', 'db-consistency'])
    expect(SYSTEM_CRON_JOBS.map((j) => j.name).sort()).toEqual(['Bug Bounty', 'DB Consistency'])
  })

  test('isSystemCronJob matches workflow.systemKind or catalog name', () => {
    expect(
      isSystemCronJob({
        name: 'Custom',
        workflow: { systemKind: 'db-consistency' },
      }),
    ).toBe('db-consistency')
    expect(isSystemCronJob({ name: 'Bug Bounty', workflow: {} })).toBe('bug-bounty')
    expect(isSystemCronJob({ name: 'Other', workflow: {} })).toBeNull()
  })
})
