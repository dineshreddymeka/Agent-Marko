/**
 * Local SCA / license policy + security hygiene asserts.
 *
 * Policy (LICENSES.md): MIT, Apache-2.0, BSD, ISC, PostgreSQL only.
 * Not wired into GitHub Actions — run locally or in your enterprise pipeline:
 *   bun run sca:check
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir.replace(/[/\\]scripts$/, '')

const ALLOWED_LICENSE =
  /^(MIT|Apache-2\.0|Apache-2\.0 WITH LLVM-exception|ISC|BSD|BSD-2-Clause|BSD-3-Clause|0BSD|PostgreSQL)(\s*\*)?$/i

/** Forbidden when they appear as a required (non-OR) license token. */
const FORBIDDEN_LICENSE =
  /\b(AGPL(?:-?\d+(?:\.\d+)?)?|GPL(?:-?\d+(?:\.\d+)?)?|LGPL(?:-?\d+(?:\.\d+)?)?|SSPL(?:-?\d+(?:\.\d+)?)?|BSL(?:-1\.1)?|BUSL(?:-1\.1)?|Commons-Clause|CC-BY-NC|Elastic(?:-2\.0)?|RSAL|PolyForm-Noncommercial|Proprietary)\b/i

const WORKSPACE_PACKAGE_JSONS = [
  'package.json',
  'app/package.json',
  'server/package.json',
  'packages/shared/package.json',
] as const

const HYGIENE = [
  {
    path: 'server/src/cowork/task.ts',
    mustContain: ['resolveAllowedSourcePath'],
    label: 'cowork path jail (resolveAllowedSourcePath)',
  },
  {
    path: 'app/src/components/chat/ToolCallCard.tsx',
    mustNotContain: ['dangerouslySetInnerHTML'],
    label: 'ToolCallCard must not use dangerouslySetInnerHTML',
  },
] as const

type PkgJson = {
  name?: string
  private?: boolean
  license?: string | { type?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

let failed = false

function fail(msg: string): void {
  console.error(`✗ ${msg}`)
  failed = true
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function normalizeLicense(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'object' && raw !== null && 'type' in raw) {
    const t = (raw as { type?: string }).type
    return typeof t === 'string' ? t.trim() : ''
  }
  return String(raw).trim()
}

/** Infer SPDX-ish id from a LICENSE file when package.json omits `license`. */
function inferLicenseFromFile(pkgDir: string): string {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENCE', 'LICENCE.md', 'COPYING']) {
    const p = join(pkgDir, name)
    if (!existsSync(p)) continue
    let text: string
    try {
      text = readFileSync(p, 'utf8').slice(0, 4000)
    } catch {
      continue
    }
    if (/MIT License/i.test(text) || /Permission is hereby granted, free of charge/i.test(text)) {
      return 'MIT'
    }
    if (/Apache License/i.test(text) && /Version 2\.0/i.test(text)) return 'Apache-2.0'
    if (/ISC License/i.test(text)) return 'ISC'
    if (/BSD 3-Clause/i.test(text) || /Redistributions of source code must retain/i.test(text)) {
      return 'BSD-3-Clause'
    }
    if (/BSD 2-Clause/i.test(text)) return 'BSD-2-Clause'
    if (/PostgreSQL License/i.test(text)) return 'PostgreSQL'
  }
  return ''
}

function resolvePkgLicense(pkg: PkgJson, pkgJsonPath: string): string {
  const fromField = normalizeLicense(pkg.license)
  if (fromField) return fromField
  return inferLicenseFromFile(join(pkgJsonPath, '..'))
}

function licenseAllowed(license: string): boolean {
  const cleaned = license.replace(/\*$/, '').trim()
  if (!cleaned || cleaned.toUpperCase() === 'UNLICENSED') return false

  if (/\s+AND\s+/i.test(cleaned)) {
    return cleaned.split(/\s+AND\s+/i).every((part) => licenseAllowed(part.trim()))
  }
  if (/\s+OR\s+/i.test(cleaned)) {
    return cleaned.split(/\s+OR\s+/i).some((part) => licenseAllowed(part.trim()))
  }
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return licenseAllowed(cleaned.slice(1, -1).trim())
  }
  return ALLOWED_LICENSE.test(cleaned)
}

function hasForbiddenToken(license: string): boolean {
  if (/\s+OR\s+/i.test(license)) {
    const parts = license.split(/\s+OR\s+/i)
    if (parts.some((p) => licenseAllowed(p.trim()))) return false
  }
  return FORBIDDEN_LICENSE.test(license)
}

function readJson(path: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PkgJson
  } catch {
    return null
  }
}

function resolveInstalledPkg(depName: string): string | null {
  const parts = depName.startsWith('@') ? depName.split('/') : [depName]
  const candidates = [
    join(root, 'node_modules', ...parts, 'package.json'),
    join(root, 'app', 'node_modules', ...parts, 'package.json'),
    join(root, 'server', 'node_modules', ...parts, 'package.json'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function collectDirectDeps(): Map<string, { versionSpec: string; from: string }> {
  const deps = new Map<string, { versionSpec: string; from: string }>()
  for (const rel of WORKSPACE_PACKAGE_JSONS) {
    const abs = join(root, rel)
    const pkg = readJson(abs)
    if (!pkg) {
      fail(`Missing workspace package.json: ${rel}`)
      continue
    }
    for (const [section, map] of [
      ['dependencies', pkg.dependencies],
      ['devDependencies', pkg.devDependencies],
    ] as const) {
      if (!map) continue
      for (const [name, versionSpec] of Object.entries(map)) {
        if (versionSpec.startsWith('workspace:')) continue
        if (!deps.has(name)) {
          deps.set(name, { versionSpec, from: `${rel} (${section})` })
        }
      }
    }
  }
  return deps
}

function checkLicenses(): void {
  console.log('\n── License policy (direct deps) ──')
  const deps = collectDirectDeps()
  if (deps.size === 0) {
    fail('No direct dependencies found to check')
    return
  }
  ok(`Scanning ${deps.size} direct dependencies`)

  for (const [name, meta] of [...deps.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pkgPath = resolveInstalledPkg(name)
    if (!pkgPath) {
      fail(`${name}: not installed (from ${meta.from}) — run bun install`)
      continue
    }
    const pkg = readJson(pkgPath)
    if (!pkg) {
      fail(`${name}: could not read ${pkgPath}`)
      continue
    }
    const license = resolvePkgLicense(pkg, pkgPath)
    if (!license) {
      fail(
        `${name}: missing license field and no recognizable LICENSE file (from ${meta.from})`,
      )
      continue
    }
    if (hasForbiddenToken(license)) {
      fail(
        `${name}: forbidden license "${license}" (from ${meta.from}) — policy allows MIT/Apache/BSD/ISC/PostgreSQL only`,
      )
      continue
    }
    if (!licenseAllowed(license)) {
      fail(
        `${name}: license "${license}" not in allowlist (from ${meta.from}) — see LICENSES.md`,
      )
      continue
    }
    console.log(`  · ${name}: ${license}`)
  }
}

function checkPackageLicenseFile(
  pkgJsonPath: string,
  hits: string[],
  seen: Set<string>,
): void {
  if (!existsSync(pkgJsonPath)) return
  const pkg = readJson(pkgJsonPath)
  if (!pkg?.name || pkg.private) return
  const license = resolvePkgLicense(pkg, pkgJsonPath)
  const key = `${pkg.name}@${license || 'UNKNOWN'}`
  if (seen.has(key)) return
  seen.add(key)
  if (license && hasForbiddenToken(license) && !licenseAllowed(license)) {
    hits.push(`${pkg.name}: ${license}`)
  }
}

/** Walk node_modules + Bun `.bun` store (scoped + nested). */
function walkNodeModules(
  nmDir: string,
  depth: number,
  hits: string[],
  seen: Set<string>,
): void {
  if (depth > 12) return
  let entries: string[]
  try {
    entries = readdirSync(nmDir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === '.bin' || entry === '.cache' || entry === '.vite' || entry === '.vite-temp') {
      continue
    }
    if (entry.startsWith('.') && entry !== '.bun') continue
    const full = join(nmDir, entry)

    if (entry === '.bun') {
      let storeEntries: string[]
      try {
        storeEntries = readdirSync(full)
      } catch {
        continue
      }
      for (const storePkg of storeEntries) {
        const nested = join(full, storePkg, 'node_modules')
        if (existsSync(nested)) walkNodeModules(nested, depth + 1, hits, seen)
      }
      continue
    }

    if (entry.startsWith('@')) {
      let scoped: string[]
      try {
        scoped = readdirSync(full)
      } catch {
        continue
      }
      for (const name of scoped) {
        const pkgDir = join(full, name)
        checkPackageLicenseFile(join(pkgDir, 'package.json'), hits, seen)
        const nested = join(pkgDir, 'node_modules')
        if (existsSync(nested)) walkNodeModules(nested, depth + 1, hits, seen)
      }
      continue
    }

    checkPackageLicenseFile(join(full, 'package.json'), hits, seen)
    const nested = join(full, 'node_modules')
    if (existsSync(nested)) walkNodeModules(nested, depth + 1, hits, seen)
  }
}

function checkForbiddenInTree(): void {
  console.log('\n── Forbidden-license pattern scan (node_modules / .bun) ──')
  const nmRoots = [
    join(root, 'node_modules'),
    join(root, 'app', 'node_modules'),
    join(root, 'server', 'node_modules'),
    join(root, 'packages', 'shared', 'node_modules'),
  ].filter(existsSync)

  if (nmRoots.length === 0) {
    fail('No node_modules found — run bun install')
    return
  }

  const hits: string[] = []
  const seen = new Set<string>()
  for (const nm of nmRoots) walkNodeModules(nm, 0, hits, seen)

  if (hits.length > 0) {
    for (const h of hits.slice(0, 40)) fail(`transitive: ${h}`)
    if (hits.length > 40) fail(`… and ${hits.length - 40} more forbidden licenses`)
  } else {
    ok(`No forbidden license patterns in ${seen.size} scanned packages`)
  }
}

function checkHygiene(): void {
  console.log('\n── Security hygiene asserts (Bugbot fixes) ──')
  for (const check of HYGIENE) {
    const abs = join(root, check.path)
    if (!existsSync(abs)) {
      fail(`${check.label}: file missing (${check.path})`)
      continue
    }
    const src = readFileSync(abs, 'utf8')
    if ('mustContain' in check && check.mustContain) {
      for (const needle of check.mustContain) {
        if (!src.includes(needle)) {
          fail(`${check.label}: expected to find "${needle}" in ${check.path}`)
        } else {
          ok(`${check.label}: found "${needle}"`)
        }
      }
    }
    if ('mustNotContain' in check && check.mustNotContain) {
      for (const needle of check.mustNotContain) {
        if (src.includes(needle)) {
          const withoutComments = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '')
          if (withoutComments.includes(needle)) {
            fail(`${check.label}: found "${needle}" in ${check.path}`)
          } else {
            ok(`${check.label}: no live "${needle}" (comment-only OK)`)
          }
        } else {
          ok(`${check.label}: no "${needle}"`)
        }
      }
    }
  }
}

console.log('SCA / license policy check (local)')
console.log(`Root: ${root}`)

checkLicenses()
checkForbiddenInTree()
checkHygiene()

console.log('')
if (failed) {
  console.error('sca:check FAILED — fix license or hygiene issues above')
  process.exit(1)
}
console.log('sca:check PASSED')
