#!/usr/bin/env bun
/**
 * Write docs/openapi.json from the live OpenAPI registry (for PR review / external tooling).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildOpenApiDocument } from '../server/src/rest/openapi/document'

const root = join(import.meta.dir, '..')
const out = join(root, 'docs', 'openapi.json')
mkdirSync(join(root, 'docs'), { recursive: true })
const doc = buildOpenApiDocument()
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`Wrote ${out} (${Object.keys(doc.paths).length} paths)`)
