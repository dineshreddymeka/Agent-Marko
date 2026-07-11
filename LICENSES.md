# Dependency licenses

Hermes UI uses **permissive licenses only** (MIT, Apache-2.0, PostgreSQL, ISC, BSD). No GPL, AGPL, SSPL, or BSL.

## Direct dependencies (runtime)

| Package | License |
|---------|---------|
| react / react-dom | MIT |
| @tanstack/react-router | MIT |
| @tanstack/react-query | MIT |
| @tanstack/react-virtual | MIT |
| @ag-ui/client | MIT |
| zustand | MIT |
| tailwindcss | MIT |
| lucide-react | ISC |
| cmdk | MIT |
| react-markdown | MIT |
| remark-gfm | MIT |
| shiki | MIT |
| fast-json-patch | MIT |
| clsx | MIT |
| @ag-ui/core | MIT |
| drizzle-orm | Apache-2.0 |
| drizzle-kit | Apache-2.0 |
| zod | MIT |
| croner | MIT |
| better-auth | MIT |
| @modelcontextprotocol/sdk | MIT |
| Bun (runtime) | MIT |

## Infrastructure

| Component | License |
|-----------|---------|
| PostgreSQL 18 | PostgreSQL License |
| pgvector | PostgreSQL License |

Audit command: `bun pm ls` — re-run before each release and update this file if dependencies change.
