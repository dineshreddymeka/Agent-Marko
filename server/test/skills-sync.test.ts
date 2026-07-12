/**
 * Unit tests for skills sync helpers (slug, hash, source inference).
 * Author: Dinesh Reddy Meka
 */
import { describe, expect, test } from 'bun:test'
import {
  formatSkillMarkdown,
  inferSkillSource,
  skillContentHash,
  skillRelativePath,
  skillSlug,
} from '../src/skills/sync-helpers'

describe('skillSlug', () => {
  test('normalizes names to kebab-case', () => {
    expect(skillSlug('My Cool Skill')).toBe('my-cool-skill')
    expect(skillSlug('  jarvis_bridge  ')).toBe('jarvis-bridge')
    expect(skillSlug('!!!')).toBe('skill')
  })
})

describe('skillContentHash', () => {
  test('is stable for identical content', () => {
    const a = skillContentHash('---\nname: x\n---\n\nbody\n')
    const b = skillContentHash('---\nname: x\n---\n\nbody\n')
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  test('changes when body changes', () => {
    const a = skillContentHash('body-a')
    const b = skillContentHash('body-b')
    expect(a).not.toBe(b)
  })
})

describe('inferSkillSource', () => {
  test('detects learned / git / builtin segments', () => {
    const root = 'C:/skills'
    expect(inferSkillSource('C:/skills/learned/foo/SKILL.md', root)).toBe('learned')
    expect(inferSkillSource('C:/skills/git/abc/foo/SKILL.md', root)).toBe('git:local')
    expect(inferSkillSource('C:/skills/builtin/foo/SKILL.md', root)).toBe('builtin')
    expect(inferSkillSource('C:/skills/foo/SKILL.md', root)).toBe('user-folder')
  })
})

describe('formatSkillMarkdown', () => {
  test('wraps bare body with frontmatter', () => {
    const md = formatSkillMarkdown({ name: 'demo', description: 'd', body: 'Do things.' })
    expect(md).toContain('name: demo')
    expect(md).toContain('description: d')
    expect(md).toContain('Do things.')
  })
})

describe('skillRelativePath', () => {
  test('places learned under learned/', () => {
    expect(skillRelativePath('foo', 'learned').replace(/\\/g, '/')).toBe('learned/foo/SKILL.md')
    expect(skillRelativePath('foo', 'user-folder').replace(/\\/g, '/')).toBe('foo/SKILL.md')
  })
})
