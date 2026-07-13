---
name: google-workspace
description: Integrate and administer Google Workspace — Gmail, Calendar, Drive, Admin SDK, Directory API, and OAuth for user-delegated or domain-wide service accounts.
triggers: ["google workspace", "g suite", "gmail api", "google calendar api", "google drive api", "admin sdk", "directory api", "workspace admin", "domain-wide delegation", "google oauth", "google sheets api", "google docs api"]
---

# Google Workspace

Use this skill when the task involves **Workspace user data or admin operations** — mail, calendars, Drive files, group membership, or domain settings. This is separate from **GCP infrastructure** (see `google-cloud` skill).

## Auth models

| Model | Use when |
|-------|----------|
| **OAuth 2.0 (user consent)** | App acts on behalf of a signed-in user (read their calendar, send mail). |
| **Service account + domain-wide delegation** | Server-side automation across users in a Workspace domain (admin must authorize client ID + scopes in Admin Console). |
| **Service account (no delegation)** | Shared Drive / resources the SA owns directly. |

**User OAuth flow (web app):**
1. Create OAuth client in Google Cloud Console → APIs & Services → Credentials (type: Web application).
2. Enable APIs: Gmail, Calendar, Drive, Admin SDK as needed.
3. Scopes are **sensitive/restricted** — keep the list minimal and submit for verification if public.
4. Exchange auth code for tokens; store refresh token encrypted server-side.

**Domain-wide delegation:**
1. Create service account in GCP project; download key securely.
2. Admin Console → Security → API controls → Domain-wide delegation → add SA client ID + scopes.
3. Use `subject` impersonation in SDK: act as `user@domain.com`.

```python
# Python pattern (google-auth + google-api-python-client)
from google.oauth2 import service_account
creds = service_account.Credentials.from_service_account_file(
    "sa.json", scopes=SCOPES, subject="user@company.com"
)
```

## Key APIs

### Gmail
- `gmail.users.messages.list`, `gmail.users.messages.get`, `gmail.users.messages.send`
- Prefer **`users.messages.batchModify`** for bulk label changes.
- Push notifications via **Cloud Pub/Sub** watch (`users.watch`).

### Calendar
- `calendar.events.list` with `timeMin` / `timeMax` (RFC3339 UTC).
- Use **`syncToken`** for incremental sync; handle `410 Gone` by full resync.
- Shared calendars: need correct `calendarId` (often email form).

### Drive
- `files.list` with `q` query (`'FOLDER_ID' in parents and trashed=false`).
- Shared drives: set `supportsAllDrives=true`, `includeItemsFromAllDrives=true`.
- Export Google Docs: `files.export` with MIME (e.g. `text/plain`, `application/pdf`).

### Admin SDK (Directory)
- Users, groups, org units — requires admin-level scopes (`admin.directory.user`).
- Rate limits apply; use **`pageToken`** pagination.

## CLI and quick probes

There is no single `gws` CLI from Google. Typical approaches:
- **`gam`** (GAM / GAMADV-XTD3) for admin automation (third-party, widely used).
- **`gcloud`** only for the **GCP project** backing OAuth clients, not for reading user mail.
- **`curl`** against REST with a bearer token for debugging.

```bash
# Example: list calendars (user token)
curl -H "Authorization: Bearer ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/users/me/calendarList"
```

## Safety and compliance

- Request **minimum scopes**; Gmail `readonly` vs `modify` vs `send` matters for audit.
- Domain-wide delegation is powerful — restrict to dedicated SAs and rotate keys.
- Respect **DLP**, retention, and eDiscovery policies; don't exfiltrate mail/calendar bulk without explicit user intent.
- Pub/Sub push endpoints must verify JWT from Google.

## Hermes note

Hermes ships **Microsoft Graph Office Briefing** (`/api/office/*`) for calendar/meeting context. For Google Calendar parity, you would build a similar OAuth module with Calendar API scopes — reuse Hermes patterns from `server/src/rest/office.ts` (encrypted token storage, refresh, PKCE) but point at Google OAuth endpoints.

## References

- Workspace APIs: https://developers.google.com/workspace
- OAuth scopes: https://developers.google.com/identity/protocols/oauth2/scopes
- Admin SDK: https://developers.google.com/admin-sdk
- Domain-wide delegation: https://developers.google.com/cloud-search/docs/guides/delegation
