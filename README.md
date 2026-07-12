# Hermes UI

Modern Hermes Agent WebUI — Bun monorepo with React 19 frontend and Bun server.

## Quick start

```bash
bun install
bun run dev
```

- Frontend: http://localhost:5173
- API health: http://127.0.0.1:3001/api/health

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Vite app + Bun server concurrently |
| `bun run build` | Build app and server |
| `bun run test` | Run smoke tests across workspaces |
| `bun run lint` | ESLint |
| `bun run db:up` | Start Postgres + pgvector (Docker) |
| `bun run db:down` | Stop database |
| `bun run migrate` | Run DB migrations |
| `bun run verify:phase2` | Docker up, migrate, integration tests, health, backup |
| `bun run verify:phase3` | Mock LLM AG-UI stream + SSE smoke (no API key) |
| `bun run verify:phase3:llm` | Real LLM smoke (skips if no API key) |
| `bun run verify:offline` | Debug replay without Postgres (in-memory run buffer) |
| `bun run verify:a2ui` | A2UI demo scenarios (cron, memory, skills) |
| `bun run verify:lighthouse` | Lighthouse performance on built shell |
| `bun run verify:all` | All verifiers (skips Phase 2 if Docker daemon unavailable) |
| `bun run test:e2e` | Playwright smoke tests (starts dev server) |

CI runs on push/PR via `.github/workflows/ci.yml` plus dedicated free security workflows.

### Free security scanning (GitHub + OSS)

SCA policy is **strict**: dependency scanners fail on **low+** severity (and Trivy also fails unfixed advisories). License gates deny copyleft/SSPL/BUSL and only allow MIT/Apache/BSD-family (plus PostgreSQL).

| Scanner | Workflow / config | Secret needed? | SCA strictness |
|---------|-------------------|----------------|----------------|
| **Dependabot** updates | [`.github/dependabot.yml`](./.github/dependabot.yml) | No (enable Dependabot alerts in repo Settings → Code security) | PR updates |
| **CodeQL** | [`.github/workflows/codeql.yml`](./.github/workflows/codeql.yml) | No (public repos) | SAST |
| **Dependency Review** | [`.github/workflows/dependency-review.yml`](./.github/workflows/dependency-review.yml) | No (PRs; free on public repos) | fail-on-severity: **low** |
| **Gitleaks** (secrets) | [`.github/workflows/security-scans.yml`](./.github/workflows/security-scans.yml) | No | secrets |
| **Trivy** (FS vulns) | same | No | CRITICAL→LOW, fail unfixed |
| **OSV Scanner** | same | No | any vuln fails |
| **OpenSSF Scorecard** | same | No | supply-chain |
| **Semgrep** (SAST) | same | No | ERROR+ |
| **Bun audit** | same | No | `--audit-level=low` |
| **Snyk** | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) | `SNYK_TOKEN` (optional) | `--severity-threshold=low` |
| **SonarCloud** | same | `SONAR_TOKEN` (optional) | quality/SAST |

Also turn on (repo **Settings → Code security and analysis**, free for public repos):

- Dependabot alerts + security updates
- Secret scanning (+ push protection if available)
- Code scanning (CodeQL workflow above uploads results)

### Free Snyk (optional)

CI includes a free-tier [Snyk](https://snyk.io) job for dependency and code scanning. To enable it:

1. Sign up at https://app.snyk.io (Free plan).
2. Copy your API token from **Account Settings → General**.
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
4. Name: `SNYK_TOKEN`, value: your token.

Until the secret is set, the Snyk job skips cleanly. With the token present, scans fail the job on **low** (or worse) severity findings (`--fail-on=all`). Pushes to `main` also run `snyk monitor` so the project stays visible in the Snyk dashboard.
### Free SonarCloud (optional)

CI includes a full-project [SonarCloud](https://sonarcloud.io) scan so nothing in the monorepo is skipped:

- Sources: entire repo (`sonar.sources=.`) including `app`, `server`, `packages/shared`, `scripts`, SQL migrations, GitHub workflows, and `docker-compose.yml`
- Tests: unit suites + Playwright `e2e` + colocated `*.test.ts`
- Coverage: LCOV from `bun test --coverage`
- Quality gate: `sonar.qualitygate.wait=true` (job fails if the gate fails)

To enable it:

1. Sign up / import this repo at https://sonarcloud.io/projects/create (Free or OSS plan for public repos).
2. Match `sonar.organization` and `sonar.projectKey` in [`sonar-project.properties`](./sonar-project.properties) to the values SonarCloud shows for the project.
3. Generate a token: **My Account → Security → Generate Token**.
4. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
5. Name: `SONAR_TOKEN`, value: your token.

Until the secret is set, the SonarCloud job skips cleanly.

Settings → **Debug** tab: replay recorded AG-UI runs through the UI dispatcher.

See [PLAN.md](./PLAN.md) for the full engineering plan.
