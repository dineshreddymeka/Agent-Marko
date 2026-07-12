import { describe, expect, test } from 'bun:test'
import {
  buildDocumentDraftMarkdown,
  documentDraftPath,
  extractDocumentTopic,
  inferDeliverableType,
  looksLikeDocumentIntent,
  looksLikeEmptyAcknowledgment,
  looksLikePresentationIntent,
  prefersCoworkDocument,
  shouldAutoCreateDocumentDraft,
  shouldAutoShowDocumentForm,
  slugifyTopic,
} from '../src/agent/document-intent'

describe('document intent routing', () => {
  test('looksLikeDocumentIntent accepts create/draft/work-file asks', () => {
    expect(looksLikeDocumentIntent('create work file and draft about jnj')).toBe(true)
    expect(looksLikeDocumentIntent('draft a document about Johnson & Johnson')).toBe(true)
    expect(looksLikeDocumentIntent('write a report on Q3 results')).toBe(true)
    expect(looksLikeDocumentIntent('create a PDF about jnj')).toBe(true)
    expect(looksLikeDocumentIntent('make a word doc regarding the merger')).toBe(true)
    expect(looksLikeDocumentIntent('can you create a document for me?')).toBe(true)
    expect(looksLikeDocumentIntent('i need a ppt')).toBe(true)
  })

  test('looksLikePresentationIntent catches ppt/slides/deck', () => {
    expect(looksLikePresentationIntent('i need a ppt')).toBe(true)
    expect(looksLikePresentationIntent('create a powerpoint on jnj')).toBe(true)
    expect(looksLikePresentationIntent('make a slide deck')).toBe(true)
    expect(looksLikePresentationIntent('build a presentation')).toBe(true)
    expect(looksLikePresentationIntent('draft a document about jnj')).toBe(false)
    expect(looksLikePresentationIntent('hi')).toBe(false)
  })

  test('looksLikeDocumentIntent rejects greetings and unrelated chat', () => {
    expect(looksLikeDocumentIntent('hi')).toBe(false)
    expect(looksLikeDocumentIntent('hello')).toBe(false)
    expect(looksLikeDocumentIntent('how are you')).toBe(false)
    expect(looksLikeDocumentIntent('what is the weather')).toBe(false)
    expect(looksLikeDocumentIntent('add a cron job')).toBe(false)
  })

  test('extractDocumentTopic ignores pronoun fillers like for me', () => {
    expect(extractDocumentTopic('create work file and draft about jnj')).toBe('jnj')
    expect(extractDocumentTopic('draft a document about Johnson & Johnson')).toBe(
      'Johnson & Johnson',
    )
    expect(extractDocumentTopic('create a powerpoint on jnj')).toBe('jnj')
    expect(extractDocumentTopic('can you create a document for me?')).toBeNull()
    expect(extractDocumentTopic('i need a ppt')).toBeNull()
    expect(slugifyTopic('Johnson & Johnson')).toBe('johnson-johnson')
    expect(documentDraftPath('jnj')).toBe('drafts/jnj-draft.md')
  })

  test('inferDeliverableType maps ppt/pdf/word/markdown', () => {
    expect(inferDeliverableType('i need a ppt')).toBe('presentation')
    expect(inferDeliverableType('create a powerpoint on jnj')).toBe('presentation')
    expect(inferDeliverableType('create a PDF about jnj')).toBe('pdf')
    expect(inferDeliverableType('make a word doc regarding the merger')).toBe('word')
    expect(inferDeliverableType('create work file and draft about jnj')).toBe('markdown')
    expect(inferDeliverableType('can you create a document for me?')).toBeNull()
  })

  test('shouldAutoShowDocumentForm for vague doc/PPT asks', () => {
    expect(shouldAutoShowDocumentForm('i need a ppt')).toBe(true)
    expect(shouldAutoShowDocumentForm('can you create a document for me?')).toBe(true)
    expect(shouldAutoShowDocumentForm('create a powerpoint on jnj')).toBe(true)
    expect(shouldAutoShowDocumentForm('create a PDF about jnj')).toBe(true)
    expect(shouldAutoShowDocumentForm('create work file and draft about jnj')).toBe(false)
    expect(shouldAutoShowDocumentForm('hi')).toBe(false)
  })

  test('shouldAutoCreateDocumentDraft skips office/PPT and unclear topics', () => {
    expect(shouldAutoCreateDocumentDraft('create work file and draft about jnj')).toBe(true)
    expect(shouldAutoCreateDocumentDraft('create a PDF about jnj')).toBe(false)
    expect(shouldAutoCreateDocumentDraft('i need a ppt')).toBe(false)
    expect(shouldAutoCreateDocumentDraft('can you create a document for me?')).toBe(false)
    expect(prefersCoworkDocument('create a PDF about jnj')).toBe(true)
    expect(prefersCoworkDocument('create work file and draft about jnj')).toBe(false)
    expect(prefersCoworkDocument('i need a ppt')).toBe(true)
  })

  test('buildDocumentDraftMarkdown includes topic', () => {
    const md = buildDocumentDraftMarkdown('jnj', 'create work file and draft about jnj')
    expect(md).toContain('# Draft: jnj')
    expect(md).toContain('create work file and draft about jnj')
    expect(md).toContain('Open Jarvis')
  })

  test('looksLikeEmptyAcknowledgment catches generic replies', () => {
    expect(looksLikeEmptyAcknowledgment('Understood. What would you like help with?')).toBe(true)
    expect(looksLikeEmptyAcknowledgment('Sure! How can I help?')).toBe(true)
    expect(looksLikeEmptyAcknowledgment('What would you like help with?')).toBe(true)
    expect(
      looksLikeEmptyAcknowledgment(
        'Created a working draft about jnj at drafts/jnj-draft.md.',
      ),
    ).toBe(false)
  })
})
