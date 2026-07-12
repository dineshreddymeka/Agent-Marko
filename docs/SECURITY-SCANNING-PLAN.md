# Security scanning plan (no CI wiring)

**Decision:** Do **not** wire Snyk / SonarQube / SCA into hermes-ui GitHub Actions.
The org already runs those tools. This repo provides:

1. `sonar-project.properties` for Enterprise Sonar imports
2. Local `bun run sca:check` (license + hygiene asserts)
3. Unit tests that catch security regressions scanners look for

## Deliverables

| Work | Status |
| --- | --- |
| Remove GH Actions security workflows | Done — no `security-*.yml` |
| Docs: point enterprise tools at repo | `docs/SECURITY-SCANNING.md` |
| Local SCA hygiene script | `scripts/sca-check.ts` + `bun run sca:check` |
| Security unit tests (path jail, XSS HTML, memory PATCH, persisted session) | `server/test/cowork-path-jail.test.ts`, `app/test/a2ui-actions.test.ts`, `app/test/security-hygiene.test.ts` |

## Acceptance

- [x] No `security-snyk.yml` / `security-sonar.yml` / `security-sca.yml` in `.github/workflows`
- [x] Enterprise scan instructions documented (no soft-skip GH Actions)
- [x] `bun run sca:check` available locally
- [x] Security-related unit tests present
