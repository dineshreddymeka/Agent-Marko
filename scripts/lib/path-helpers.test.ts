import { describe, expect, test } from 'bun:test'
import { dockerPathEnv, dockerCandidates } from '../lib/docker-path'
import { resolveBunExecutable } from '../lib/bun-path'

describe('docker-path helpers', () => {
  test('dockerPathEnv is empty on non-Windows', () => {
    if (process.platform === 'win32') {
      const env = dockerPathEnv()
      expect(env.PATH ?? env.Path).toContain('Docker')
      expect(env.PATH ?? env.Path).toContain(';')
    } else {
      expect(dockerPathEnv()).toEqual({})
    }
  })

  test('candidates always include bare docker', () => {
    expect(dockerCandidates[0]).toBe('docker')
  })
})

describe('bun-path helper', () => {
  test('resolveBunExecutable returns a non-empty string', () => {
    expect(resolveBunExecutable().length).toBeGreaterThan(0)
  })
})
