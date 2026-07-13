# Open Jarvis

**Author:** Dinesh Reddy Meka  
Open Jarvis — Bun monorepo with React 19 frontend and Bun AG-UI server (Cursor-style agent UI).

**Source of truth (engineering plan):** `C:\Users\dines\BMC\BMC-backend\HERMES-UI-PLAN.md`  
Local notes: [PLAN.md](./PLAN.md) · [docs/SOURCE-OF-TRUTH.md](./docs/SOURCE-OF-TRUTH.md) · [docs/LOGGING.md](./docs/LOGGING.md) · [docs/FEATURE-VERIFICATION.md](./docs/FEATURE-VERIFICATION.md) · [docs/PARALLEL-AGENT-PLAN.md](./docs/PARALLEL-AGENT-PLAN.md)

## Quick start

```bash
bun install
bun run db:up    # Postgres 17 + pgvector (Docker) — SoT image 0.8.5-pg17
bun run migrate
bun run dev
```

- Frontend: http://localhost:5173
- API health: http://127.0.0.1:3001/api/health
- **Fleet deploy (LDAP, hundreds of hosts):** [docs/FLEET-DEPLOY.md](./docs/FLEET-DEPLOY.md)
- API docs (Scalar): http://127.0.0.1:3001/api/docs · OpenAPI JSON: `/api/openapi.json` (`bun run openapi:export` writes `docs/openapi.json`)

## Verify matrix

| Command | What it proves |
|---------|----------------|
| `bun test app server packages/shared` | Unit / smoke (CI + local) |
| `bun run verify:phase1` | Scaffold + design-system gates |
| `bun run verify:phase2` | PG17 Docker, migrate, integration, health, backup |
| `bun run verify:phase3` | Mock AG-UI SSE (no API key) |
| `bun run verify:phase3:llm` | Real LLM (skips without `LLM_API_KEY`) |
| `bun run verify:offline` | Debug replay buffer without Postgres |
| `bun run verify:a2ui` | A2UI cron/memory/skills demos |
| `bun run test:e2e` | Playwright shell / panels / palette |
| `bun run verify:lighthouse` | Lighthouse ≥ 90 on built shell |
| `bun run verify:all` | Full matrix (skips Phase 2 if Docker unavailable) |

SoT → test mapping: [docs/FEATURE-VERIFICATION.md](./docs/FEATURE-VERIFICATION.md).

CI runs on push/PR via `.github/workflows/ci.yml` (unit + mock AG-UI + offline + A2UI + Playwright; separate Postgres **17**/pgvector migrate/integration job) plus dedicated free security workflows.

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

## Skills library

Skills are `SKILL.md` folders under `SKILLS_DIR` (default `./skills`), synced into
Postgres on boot and via **Sync from folder** in the Skills panel
(`/panel/skills`). **Create skill** writes disk + DB and queues an embedding for
retrieval. Point at legacy Hermes skills:

```env
SKILLS_DIR=C:/Users/dines/AppData/Local/hermes/skills
```

Then restart the API (or click Sync). See `docs/DATABASE-DESIGN.md` (§ skills / 0007).

## Open Cowork (Office / work requests)

Document jobs (Office panel → Cowork work requests) spawn the **Open Cowork** desktop app in headless stdio mode.

1. Install Open Cowork (Windows). The usual path is  
   `%LOCALAPPDATA%\Programs\open-cowork\Open Cowork.exe`.
2. Set in the server `.env` (then restart the API):

```env
OPEN_COWORK_EXE=C:/Users/You/AppData/Local/Programs/Open Cowork/Open Cowork.exe
# optional aliases: OPEN_COWORK_PATH or COWORK_EXE
# Or paste the path in Cowork → Setup (settings cowork.exe; no restart)
OPEN_COWORK_WORKSPACE=C:/Users/You/cowork-workspace
```

3. Check readiness: `GET /api/cowork/setup` → `configured: true` when the exe exists.

If the exe is missing, create-task returns **503** with `code: COWORK_EXE_MISSING` (no raw ENOENT). The docs/source tree under `BMC/center/open-cowork` is reference-only and is **not** a runnable binary.
