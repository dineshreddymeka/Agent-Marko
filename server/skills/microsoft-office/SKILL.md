---
name: microsoft-office
description: Work with Microsoft 365 — Outlook, Word, Excel, PowerPoint, Teams, SharePoint, and Microsoft Graph API, including Hermes Office Briefing integration and Office document patterns (docx, xlsx, pptx).
triggers: ["office", "outlook", "excel", "word", "powerpoint", "microsoft graph", "teams", "calendar briefing", "docx", "xlsx", "pptx", "sharepoint", "microsoft 365", "m365", "onedrive", "entra", "office briefing", "graph api", "exchange online"]
---

# Microsoft 365 and Office

Use this skill when the task involves **productivity data or Office files** — mail, calendar, meetings, Teams, SharePoint/OneDrive, or creating/editing Word/Excel/PowerPoint documents. For **Azure infrastructure** (VMs, storage accounts, ARM), use the `microsoft-azure` skill instead.

## Auth: delegated vs application permissions

| Model | Use when | Token |
|-------|----------|-------|
| **Delegated (user sign-in)** | App acts as the signed-in user — read their calendar, send mail on their behalf, open their OneDrive files. | User access token + refresh token (`offline_access`). |
| **Application (app-only)** | Background service with no user present — org-wide mail/calendar sync, SharePoint site indexing. | Client credentials grant; requires **admin consent** for application permissions. |

**Rules of thumb:**
- Prefer **delegated** scopes for interactive copilots and personal briefing UIs.
- Use **application** permissions only when the workload is truly unattended and tenant admin has approved.
- Never mix confidential client secrets into browser code — keep `client_secret` server-side only.
- Azure app registration platform must be **Web** (not SPA) when using auth code + PKCE with a server-held secret.

**Common delegated scopes (Microsoft Graph):**
- Mail: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
- Calendar: `Calendars.Read`, `Calendars.ReadWrite`
- Files: `Files.Read`, `Files.ReadWrite`, `Sites.Read.All` (SharePoint)
- User profile: `User.Read`
- Teams meetings: `OnlineMeetings.Read`, `OnlineMeetingArtifact.Read.All` (admin consent often required)

**Application permission examples:** `Mail.Read`, `Calendars.Read`, `Sites.Read.All` — each needs tenant admin consent in Entra ID.

## Microsoft Graph API patterns

Base URL: `https://graph.microsoft.com/v1.0` (beta only when a v1 feature is missing — document why).

```bash
# Current user profile
curl -H "Authorization: Bearer TOKEN" https://graph.microsoft.com/v1.0/me

# Today's calendar (UTC bounds; prefer outlook.timezone=UTC for stable parsing)
curl -G -H "Authorization: Bearer TOKEN" \
  --data-urlencode "startDateTime=2026-07-13T00:00:00Z" \
  --data-urlencode "endDateTime=2026-07-13T23:59:59Z" \
  --data-urlencode "Prefer=outlook.timezone=\"UTC\"" \
  https://graph.microsoft.com/v1.0/me/calendarView

# Send mail
curl -X POST -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"message":{"subject":"Hello","body":{"contentType":"Text","content":"Hi"},"toRecipients":[{"emailAddress":{"address":"user@contoso.com"}}]},"saveToSentItems":true}' \
  https://graph.microsoft.com/v1.0/me/sendMail

# Upload small file to OneDrive
curl -X PUT -H "Authorization: Bearer TOKEN" --data-binary @report.pdf \
  "https://graph.microsoft.com/v1.0/me/drive/root:/Reports/report.pdf:/content"
```

**Pagination:** follow `@odata.nextLink`. **Throttling:** honor `Retry-After` on 429/503.

**Delta queries:** use `/messages/delta`, `/events/delta` for incremental sync; store `deltaLink` and handle `410` with full resync.

## Outlook and calendar workflows

- **Inbox triage:** list with `$filter`, `$select`, `$orderby`; batch with `$batch` for label/move operations.
- **Meeting prep:** fetch `calendarView` for the day; include `onlineMeeting.joinUrl`, attendee `status.response`.
- **Free/busy:** `POST /me/calendar/getSchedule` with attendee SMTP addresses and time window.
- **Time zones:** Graph returns `dateTime` + `timeZone`; when `Prefer: outlook.timezone="UTC"`, treat wall times as UTC (Hermes briefing uses this pattern).

## Word, Excel, PowerPoint, and SharePoint

### Graph file operations (OneDrive / SharePoint)
- List: `GET /me/drive/root/children` or `/sites/{site-id}/drive/root/children`
- Download: `GET /me/drive/items/{id}/content`
- Upload: simple PUT for &lt;4 MB; **upload session** (`createUploadSession`) for large files.
- SharePoint site ID: `GET /sites/{hostname}:/{server-relative-path}`

### Office Open XML (docx, xlsx, pptx)

These are ZIP archives of XML parts. Prefer libraries over manual XML when possible:

| Format | Node.js | Python |
|--------|---------|--------|
| docx | `docx`, `officegen` | `python-docx` |
| xlsx | `exceljs`, `xlsx` | `openpyxl`, `pandas` |
| pptx | `pptxgenjs` | `python-pptx` |

**Patterns:**
- **Mail-merge style Word:** template docx with `{placeholder}` tokens → replace in `word/document.xml` or use a library merge API.
- **Excel reports:** write to a new sheet; preserve number/date formats; avoid breaking formulas when updating cells.
- **PowerPoint decks:** clone slide layouts; export PDF via Graph `GET /drive/items/{id}/content?format=pdf` for Google-less preview.

**Do not** assume Graph can edit document *content* inline — Graph manages files; content manipulation is local/library or **Microsoft Graph Excel REST** (workbook session) for cloud workbooks.

### Excel REST (cloud workbook)
```
POST /me/drive/items/{item-id}/workbook/createSession
PATCH  .../workbook/worksheets('Sheet1')/range(address='A1')
POST   .../workbook/closeSession
```

## Teams basics

- List chats: `GET /me/chats` (delegated `Chat.Read`).
- Online meetings: create via `POST /me/onlineMeetings` or read from calendar events (`isOnlineMeeting`, `onlineMeeting.joinUrl`).
- Transcripts/recordings: `OnlineMeetingTranscript.Read.All`, `OnlineMeetingArtifact.Read.All` — typically **admin consent**; request separately after core connect succeeds.

## Hermes Office Briefing integration

Hermes ships a **Microsoft Graph calendar briefing** independent of Open Cowork desktop.

**Server env (confidential Web app):**
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID` (default `organizations`; use tenant GUID for single-tenant)
- `MICROSOFT_REDIRECT_URI` (optional; default `{BETTER_AUTH_URL}/api/office/callback`)
- `MICROSOFT_SSO_AUTO=1` — Briefing panel auto-redirects to SSO when disconnected

**Azure app registration:**
- Platform: **Web**
- Redirect URI must match exactly (local dev: `http://127.0.0.1:3001/api/office/callback`)
- Run `bun run office:sso-setup` for guided setup

**API surface (`server/src/rest/office.ts`, `server/src/office/briefing.ts`):**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/office/config` | Whether env is configured, redirect URI, scopes |
| `GET /api/office/status` | Connected account, token expiry, missing env keys |
| `GET /api/office/sso` | Browser redirect — auth code + PKCE sign-in |
| `POST /api/office/connect` | Start OAuth (optional artifact scopes) |
| `GET /api/office/callback` | OAuth callback; stores encrypted tokens in settings |
| `POST /api/office/disconnect` | Revoke local tokens |
| `GET /api/office/briefing?start=&end=&tz=` | Live agenda, stats, insights for the day |

**Core delegated scopes** (user consent on first connect): `offline_access`, `User.Read`, `Calendars.Read`, `OnlineMeetings.Read`.

**Artifact scopes** (optional, admin consent): `OnlineMeetingArtifact.Read.All`, `OnlineMeetingTranscript.Read.All` — requested only after core connect to avoid blocking first login.

**UI:** `app/src/components/panels/BriefingPanel.tsx` — `/panel/briefing`; uses `/api/office/status`, `/api/office/sso`, `/api/office/briefing`.

When helping users with briefing issues:
1. Confirm `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` in server `.env`.
2. Match Azure redirect URI to `GET /api/office/config` → `redirectUri`.
3. Restart server after env changes.
4. Check token refresh errors in server logs; disconnect and reconnect if scopes changed.

## Safety

- Store refresh tokens **encrypted** (Hermes uses `server/src/office/crypto.ts`).
- Request minimum scopes; add artifact/transcript scopes only when needed.
- Respect tenant DLP, retention, and eDiscovery — don't bulk-export mail without explicit intent.
- For app-only permissions, audit which service principal holds access and rotate secrets via Key Vault.

## When to use other skills

- **Azure VMs, AKS, storage accounts, ARM/Bicep** → `microsoft-azure`
- **Google Gmail/Drive/Calendar** → `google-workspace`
- **AWS** → `aws`

## References

- Microsoft Graph: https://learn.microsoft.com/en-us/graph/overview
- OAuth v2 auth code + PKCE: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Calendar view: https://learn.microsoft.com/en-us/graph/api/user-list-calendarview
- Hermes: `server/src/rest/office.ts`, `server/src/office/briefing.ts`, `app/src/components/panels/BriefingPanel.tsx`
