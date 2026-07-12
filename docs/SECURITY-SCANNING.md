# Security scanning (enterprise — not wired in GitHub Actions)

Open Jarvis assumes **your** existing **Snyk**, **SonarQube Enterprise**, and
**SCA** pipelines scan this repo. This project does **not** ship
`security-snyk.yml` / `security-sonar.yml` / `security-sca.yml` workflows and
does not soft-skip missing secrets in GitHub Actions.

## Point enterprise tools at this repo

### SonarQube Enterprise

Import / analyze with the checked-in [`sonar-project.properties`](../sonar-project.properties):

| Setting | Value |
| --- | --- |
| `sonar.projectKey` | `hermes-ui` |
| Sources | `app/src`, `server/src`, `packages/shared/src` |
| Exclusions | `node_modules`, `dist`, coverage, `*.gen.ts`, Playwright / Vite caches |

Configure `SONAR_HOST_URL` + `SONAR_TOKEN` in **your** enterprise secret store
(not this repository). Quality gates stay on the Sonar server.

### Snyk

Attach this GitHub repo (or local clone) to your existing Snyk org/project.
Suggested local CLI check (optional):

```bash
bun install --yarn   # only if your Snyk setup expects yarn.lock
snyk test --all-projects --severity-threshold=high
```

Use your enterprise `SNYK_TOKEN`; never commit it here.

### SCA / licenses

Policy: **MIT / Apache-2.0 / BSD / ISC / PostgreSQL only** — see [`LICENSES.md`](../LICENSES.md).

Local hygiene script (fast; complements enterprise SCA):

```bash
bun run sca:check
```

Asserts:

1. Direct dependency licenses are allowlisted (LICENSE file fallback when `package.json` omits `license`)
2. No forbidden license patterns (GPL/AGPL/SSPL/BSL/…) in installed packages
3. Hygiene: `resolveAllowedSourcePath` still present; ToolCallCard has no live `dangerouslySetInnerHTML`

## Local security regression tests

These encode the same bug classes scanners often flag:

| Concern | Where |
| --- | --- |
| Path jail / traversal | `server/test/cowork-path-jail.test.ts` |
| XSS (`dangerouslySetInnerHTML`) | `app/test/security-hygiene.test.ts` + `sca:check` |
| Memory update uses PATCH + `entryId` | `app/test/a2ui-actions.test.ts` |
| CommandPalette creates persisted sessions | `app/test/security-hygiene.test.ts` (`createPersistedSession`) |

```bash
bun test server/test/cowork-path-jail.test.ts app/test/a2ui-actions.test.ts app/test/security-hygiene.test.ts
bun run sca:check
```

## What not to add

- Do not add GitHub Actions jobs for Snyk / Sonar / SCA soft-skip.
- Keep enterprise credentials out of the repository.
