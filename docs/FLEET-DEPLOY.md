# Fleet deploy (hundreds of hosts)

Open Jarvis is designed for **one install per machine** with **env-only** configuration. No hardcoded user paths; LDAP is org-wide; only data dir and public URL change per host.

## What is the same on every host

Push via GPO, SCCM, Ansible `group_vars`, or similar:

| Setting | Purpose |
|---------|---------|
| `LDAP_*` | Corporate directory (URL, bind DN, base DN, attribute) |
| `LLM_BASE_URL` / `HERMES_AGENT_LLM_URL` | Org LLM gateway |
| `HERMES_SERVE_STATIC=1` | Single-port production (UI + API) |
| `HERMES_ALLOW_DB_PATH_SETTINGS=0` | Ignore UI-saved paths; env wins |
| `ALLOW_SIGNUP=false` | No local email signup when LDAP is on |

Template: [`deploy/fleet.env.example`](../deploy/fleet.env.example) → copy to `deploy/fleet.env` (gitignored in ops; never commit secrets).

## What differs per host

| Setting | Example |
|---------|---------|
| `HERMES_DATA_DIR` | `C:\hermes-data` (Win) or `/var/lib/hermes` (Linux) |
| `BETTER_AUTH_URL` | `https://jarvis-042.corp.example.com:3001` |
| `HERMES_PUBLIC_URL` | Same as `BETTER_AUTH_URL` unless behind a shared reverse proxy |
| `BETTER_AUTH_SECRET` | **Unique per host** — `openssl rand -base64 32` at install |

Derived automatically from `HERMES_DATA_DIR`:

- `${HERMES_DATA_DIR}/workspace`
- `${HERMES_DATA_DIR}/cowork-workspace`
- `${HERMES_DATA_DIR}/backups`
- `${HERMES_DATA_DIR}/postgres` (Docker volume)

Template: [`deploy/host.env.example`](../deploy/host.env.example)

## Install flow (one host)

### Windows

```powershell
# 1. Copy release to C:\Program Files\OpenJarvis (or SCCM package path)
# 2. Edit deploy\fleet.env with LDAP + LLM (from vault)
# 3. Install:
cd C:\Program Files\OpenJarvis
.\deploy\install-windows.ps1 -PublicUrl "https://HOSTNAME.corp.example.com:3001"
# 4. Run as service / scheduled task:
bun run start
```

### Linux

```bash
cp deploy/fleet.env.example deploy/fleet.env   # fill LDAP secrets
chmod +x deploy/install-linux.sh
sudo ./deploy/install-linux.sh --public-url https://HOSTNAME.corp.example.com:3001
sudo cp deploy/open-jarvis.service /etc/systemd/system/
sudo systemctl enable --now open-jarvis
```

## Rollout at scale (hundreds of machines)

1. **Build once** in CI: `bun run build` → zip `app/dist`, `server/`, `packages/`, `deploy/`, `package.json`, `bun.lock`.
2. **Distribute** via SCCM / Intune / Ansible / rsync.
3. **Per-host vars** only: `HOST_FQDN`, `HERMES_DATA_DIR` (if non-default).
4. **Secrets** from vault into `fleet.env` at deploy time (`LDAP_BIND_PASSWORD`, `LLM_API_KEY`) — not baked into the image.
5. **Post-install smoke** on a sample host:
   - `GET /api/health` → `ldapEnabled: true`, `authRequired: true`
   - `bun run server/scripts/ldap-probe.ts USER PASS`
   - Browser → `https://HOST/login` → LDAP sign-in → app loads

### Ansible sketch

```yaml
- hosts: jarvis_fleet
  vars_files: [group_vars/jarvis_ldap.yml]
  tasks:
    - template: src=host.env.j2 dest=/opt/open-jarvis/.env
    - command: ./deploy/install-linux.sh --public-url https://{{ ansible_fqdn }}:3001 --skip-build
      args: { chdir: /opt/open-jarvis }
```

`host.env.j2` merges fleet LDAP block + per-host `HERMES_DATA_DIR`, `BETTER_AUTH_URL`, generated `BETTER_AUTH_SECRET`.

## Database (per host)

Each fleet machine runs **local Postgres 17 + pgvector** via Docker (`bun run db:up`). Data volume:

`${HERMES_DATA_DIR}/postgres` → container `/var/lib/postgresql/data`

| Step | Command |
|------|---------|
| Start DB | `HERMES_DATA_DIR=/var/lib/hermes bun run db:up` |
| Apply schema | `bun run migrate` (includes `0015_auth.sql` for LDAP sessions) |
| Optional app role | `HERMES_APP_PASSWORD=... bun run db:create-app-role` then point `DATABASE_URL` at `hermes_app` |

Default runtime URL (local compose):

```env
DATABASE_URL=postgres://hermes:hermes@localhost:5433/hermes
```

Production: migrate with admin URL, run app with `hermes_app` (non-superuser) to preserve connection slots.

**Health checks:**

- `GET /api/health` → `db: true`, `authDb: true` (auth tables present)
- `GET /api/debug/health` (authenticated) → `authDb`, `authCounts`

LDAP login requires `authDb: true`. If false, run `bun run migrate` on that host.

## Production runtime

| Mode | Command | Ports |
|------|---------|-------|
| Dev | `bun run dev` | Vite 5173 + API 3001 |
| Fleet | `bun run start` | API 3001 serves UI + `/api/*` + `/agui` |

Set `HOST=0.0.0.0` so the host accepts LAN connections. Put TLS on a reverse proxy or terminate on the Bun port via your standard cert tooling.

## LDAP checklist

- [ ] `LDAP_ENABLED=1`
- [ ] Service account can search `LDAP_BASE_DN`
- [ ] Users sign in with `sAMAccountName` (or set `LDAP_USER_ATTRIBUTE`)
- [ ] `LDAP_EMAIL_DOMAIN` set if AD users lack `mail`
- [ ] `BETTER_AUTH_URL` matches the URL users type in the browser (cookie domain)
- [ ] Migration `0015_auth.sql` applied (`bun run migrate`)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Redirect loop / no session | `BETTER_AUTH_URL` must match browser origin; check `HERMES_PUBLIC_URL` |
| LDAP form missing | `ldapEnabled` false in `/api/health` — check `LDAP_URL` + `LDAP_BASE_DN` |
| Invalid password for valid user | Run `ldap-probe.ts`; verify bind DN/password and user search base |
| Wrong workspace path | Set `HERMES_DATA_DIR`; keep `HERMES_ALLOW_DB_PATH_SETTINGS=0` |

See also: [AGENTS.md](../AGENTS.md) (LDAP + localhost bypass), [.env.example](../.env.example).
