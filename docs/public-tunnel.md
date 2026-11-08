# Public tunnel runbook

The public Vercel app (https://devday-donor-desk.vercel.app) normally shows a read-only snapshot. This switch
points it at the laptop's FastAPI service through a Cloudflare quick tunnel, and turns it back off.
Turn it OFF right after the event.

## What changes when it is on

| Piece | Off (default) | On |
|---|---|---|
| Service CORS and WS `/transcribe/live` Origin check | localhost only | plus `PUBLIC_ORIGINS` |
| `/chat`, `/ask`, `/transcribe` | unlimited | 20 requests/min per client IP (429 above), 3 live sockets at once |
| Email and SMS | per `EMAIL_SEND` / `SMS_PROVIDER` | always simulated (dry run), whatever the env says |
| Web app | snapshot, "Sample data" badge | live data from the laptop; if the API is unreachable at start-up (2 s `/health` check) it falls back to the snapshot and the badge |
| `GET /public-mode` | `{"enabled": false}` | `{"enabled": true}` |

## On

```bash
winget install --id Cloudflare.cloudflared      # once; the script never downloads anything itself
python scripts/public_tunnel.py on              # starts the tunnel, writes .public-tunnel.json, prints the next 3 commands
```

The script prints (and does not run) these:

1. Restart the service: `PUBLIC_MODE=1 PUBLIC_ORIGINS=https://devday-donor-desk.vercel.app uvicorn service.main:app --host 127.0.0.1 --port 8000`
2. From `web/`, in Git Bash (not PowerShell: CRLF corrupts the value):
   `printf '%s' "<tunnel url>" | vercel env add VITE_API_URL production`, then the same with `local` for `VITE_DATA_MODE`
   (`vercel env rm <name> production` first if it exists).
3. `vercel --prod --yes`

Quick tunnel URLs change on every start, so repeat steps 2 and 3 after each `on`.

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
- Writes are not blocked in public mode (edits, notes, merges, uploads reach the laptop db). Back up first
  (`scripts/demo_reset.py` backs up the db).
- The rate limit protects the OpenAI and Gemini keys, not the laptop's bandwidth. The quick tunnel has no uptime promise.
- `CF-Connecting-IP` is trusted for the limit; that is safe only because the tunnel is the way in. Do not expose
  port 8000 another way while public mode is on.
- Do not leave it on: run `off` after the event.
