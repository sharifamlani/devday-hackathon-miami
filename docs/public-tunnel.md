# Public tunnel runbook

The public Vercel app (https://devday-donor-desk.vercel.app) normally shows a read-only snapshot. This switch
points it at the laptop's FastAPI service through a Cloudflare quick tunnel, and turns it back off.
Turn it OFF right after the event.

## What changes when it is on

| Piece | Off (default) | On |
|---|---|---|
| Service CORS and WS `/transcribe/live` Origin check | localhost only | plus `PUBLIC_ORIGINS` |
| Every route | open to localhost | **deny by default**: only the allow-list below, and only with the Vercel `Origin`; else 403 `not available in the public preview` |
| Contact fields | full | email and phone masked in every JSON response (`m***@example.com`, `***-***-0101`) |
| Chat agent tools | read and write | read-only: write, draft and send tools refuse ("read-only preview") and touch nothing |
| `/chat`, `/ask`, `/transcribe` | unlimited | 20 requests/min per client IP (429 above), 3 live sockets at once |
| Email and SMS | per `EMAIL_SEND` / `SMS_PROVIDER` | always simulated (dry run), whatever the env says |
| Web app | snapshot, "Sample data" badge | live data from the laptop; if the API is unreachable at start-up (2 s `/health` check) it falls back to the snapshot and the badge |
| `GET /public-mode` | `{"enabled": false}` | `{"enabled": true}` |

## On

```bash
winget install --id Cloudflare.cloudflared      # once; the script never downloads anything itself
python scripts/public_tunnel.py on --port 8401   # ALWAYS pass --port 8401 (the public copy); starts the tunnel, writes .public-tunnel.json, prints the next 3 commands
```

The demo setup tunnels **:8401**: a second service with `PUBLIC_MODE=1` over LIVE's db (run from
`C:\Users\Shari\dd-live-main`). **:8001 stays LIVE's writable laptop service and is never tunnelled.** A bare `on`
defaults to 8001, which would put LIVE's unrestricted, writable API on the internet, so always pass `--port 8401`.

The script prints (and does not run) these:

1. Restart the public copy: `PUBLIC_MODE=1 PUBLIC_ORIGINS=https://devday-donor-desk.vercel.app uvicorn service.main:app --host 127.0.0.1 --port 8401`  (the port you passed to the script)
2. From `web/`, in Git Bash (not PowerShell: CRLF corrupts the value):
   `printf '%s' "<tunnel url>" | vercel env add VITE_API_URL production`, then the same with `local` for `VITE_DATA_MODE`
   (`vercel env rm <name> production` first if it exists).
3. `vercel --prod --yes`

Quick tunnel URLs change on every start, so repeat steps 2 and 3 after each `on`.

## Show everything (`PUBLIC_SHOW_ALL=1`)

The demo data is fictional, so the demo runs public mode with `PUBLIC_SHOW_ALL=1` (Sharif, Sun Nov 8): every GET
is served (still only with the Vercel `Origin`), nothing is masked or blanked (contacts, call notes, transcripts,
staff notes, summaries and staff tasks all show), and the chat agent may read call notes and call sheets.
**Writes stay refused** and the rate limit stays. `GET /public-mode` answers `{"enabled": true, "redacted": false}`,
and the web then loads everything as in local mode. Unset, public mode redacts as described below. Anything saved
to the db later (a real call, a real number) goes public too.

## Allow-list (everything else is 403)

The Origin header is not authentication (any script can send it). The allow-list, the masking and the rate limit
are the whole defence, so the list is short and read-only apart from chat.

- GET (any Origin): `/health`, `/public-mode`.
- GET (Vercel Origin only): `/home/summary`, `/people` and `/people/*`, `/donors`, `/donors/{id}`, `/duplicates`,
  `/targets*`, `/calendar`, `/tasks`, `/artifacts`, `/events`, `/events/{id}`, `/events/{id}/drafts`, `/context`,
  `/context/search`, `/context/status`, `/community/stats`, `/alerts`, `/icp`, `/prospects*`, `/org-profile`,
  `/interest-tags`, `/campaigns*` and `/outbox` (addresses already masked).
- POST (Vercel Origin only): `/chat`, `/chat/approve`, `/ask` (20/min per IP).
- Refused: every PATCH, PUT and DELETE; `/phone/*`, `/ingest`, `/send*`, `/calls*`, `/crm/*`, `/merges*`,
  `/duplicates/*/merge`, `/enrich*`, `/context/run`, `/context/refresh`, `/events/refresh`, `/chat/stream`,
  `POST /tasks`, `POST /campaigns*`.

If staff need remote write access, do not open it here: put Cloudflare Access (Zero Trust, free tier) in front of
the tunnel so only signed-in staff reach it, and run a second tunnel for them.

## Status

`python scripts/public_tunnel.py status` prints `off`, or the pid, URL, start time and an HTTP check of `<url>/health`.

## Off

```bash
python scripts/public_tunnel.py off
```

Kills only the pid recorded in `.public-tunnel.json`, after confirming that process is `cloudflared`. The tunnel URL
stops answering at once. It then prints the commands to set `VITE_DATA_MODE=snapshot` and redeploy. Until the redeploy
the web app falls back to the snapshot by itself. Restart the service without `PUBLIC_MODE`.

## What judges see

The same Donor Desk, now backed by the live laptop database: real searches, chat and Ask answers from the model.
Sends say "queued (dry run)". If the laptop sleeps or the tunnel dies, the page loads the snapshot with the
"Sample data" badge on the next visit; a session already open keeps retrying and shows request errors.

## Risks

- Anyone with the URL reaches the service, and the Vercel site is public. Data on screen is the laptop's database:
  confirm it holds only demo or approved data before turning this on.
- Writes are blocked in public mode (HTTP allow-list, read-only chat agent). Still back up first
  (`scripts/demo_reset.py` backs up the db).
- The rate limit protects the OpenAI and Gemini keys, not the laptop's bandwidth. The quick tunnel has no uptime promise.
- `CF-Connecting-IP` is trusted for the limit; that is safe only because the tunnel is the way in. Do not expose
  the service port another way while public mode is on.
- Do not leave it on: run `off` after the event.
