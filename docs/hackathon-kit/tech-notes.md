# Tech notes: proven parts to lift, and the traps

Everything here ran on stage at least once. **Lift it, don't rewrite it**: copy the files first,
then change only imports, config, domain data, auth, logging and entry points. At Converge, the
voice interviewer went from one repo to the next in two minutes this way.

Source repos:
- **Converge** (this repo): https://github.com/sharifamlani/creative-tech-buildathon (private; ask Sharif for access)
- **Hack for Humanity** (the win): https://github.com/sharifamlani/hack-for-humanity-team (public)

Stack both times: Next.js (App Router) + TypeScript + pnpm, deployed by hand to Vercel
(`vercel --prod --yes`), Gemini API for the models.

---

## Parts worth lifting

| Part | Files (Converge repo) | What it gives you | Watch out for |
|---|---|---|---|
| **Voice interviewer** (Gemini Live) | `lib/liveVoice.ts`, `app/api/voice-token/route.ts`, `components/Interviewer.tsx`, `lib/questions.ts` | A spoken guide that asks, listens and hands over what it heard. Half-duplex (the mic is off while the AI talks, so a loud room can't feed back). The real key stays on the server: the browser gets a one-use token. A `record_answer` tool call ends the interview. Typed fallback included | Pin the language (see traps). Questions live in one file so the wording can be tuned without touching components |
| **AI reading + code matching** | `app/api/curate/route.ts`, `lib/match.ts` | The model turns free text into a profile in a **fixed vocabulary**; plain code scores every record. A keyword reading runs alongside, so results appear even if the model is slow (4 s budget) | Keep the vocabulary identical on both sides (data tags and model output) |
| **Batch AI coding of a dataset** | `scripts/build-creatives.mjs`, `scripts/media/listen.mjs`, `look.mjs`, `code-works.mjs` | Offline passes where the model listens to audio, looks at images and tags records into the vocabulary; results are cached and merged | Precompute: never run this live. Check its output with real rows (it dropped 86 wrong-artist song sets) |
| **Music previews that start instantly** | `components/cards/PlayButton.tsx`, `freshTracks()` in `app/api/curate/route.ts` | Preview links refreshed at request time; preloaded 3 at a time after the page loads; no Play button when there is no music | Deezer preview links expire about 15 min after they're issued |
| **3D rooms with clickable DOM cards** | `components/rooms/RoomCanvas.tsx`, `lib/rooms/*` | three.js rooms; real HTML cards projected from 3D spots every frame, so blur, hover and click keep working. Scroll to walk | Heavy on weak GPUs and in headless browsers; test on the presenter's laptop |
| **Images that never break** | `components/cards/Peek.tsx` | `referrerPolicy="no-referrer"` (beats hotlink protection) and `onError` → drawn fallback art | — |
| **Find any link for a person** | `scripts/media/links.mjs` | Pulls Instagram / Spotify / Bandcamp / Wikipedia / site from MusicBrainz and Wikidata **by exact id**, then a work page, then a web search | MusicBrainz allows 1 request/s; skip catalog sites |
| **Voice end-to-end test** | `scripts/verify-e2e.py` (copy in `scripts/`), `scripts/make-voice.ps1` | Real Chromium on production; a recorded voice is played into the page's microphone the moment the guide starts listening, so the real voice model hears a person. Checks routing, cards, music start time, links, broken images | Edit `CASES` and the selectors for the new app (below) |
| **Live matching check** | `scripts/verify-curate-live.py` | 14 realistic prompts against the deployed API: count, latency, profile, top 5 | Re-run after every deploy that touches matching |
| **Gemma 4 calls** | `lib/gemma.ts`, `playbooks/gemma4-integration.md` | Open-weight model, which mattered for prizes at Hack for Humanity | Two traps: drop `thought: true` parts; `maxOutputTokens` ≥ 1024 and check `finishReason` |

### Adapting `verify-e2e.py` to a new app

1. Make the voices: write `answers.txt` (`name|sentence` per line), then
   `powershell -File scripts/make-voice.ps1 -Lines answers.txt -OutDir <scratch>/voice`.
2. Edit `CASES` at the top: `(kind, input, expected result)`, where kind is `voice`, `typed` or `chip`.
3. Change the selectors in `run_voice`, `room_label`, `check_card` and `check_music` to the new app's
   labels. The fake microphone (`FAKE_MIC`) works on any page that calls `getUserMedia`.
4. Run: `python scripts/verify-e2e.py <scratch>/voice https://<app>.vercel.app --shots <scratch>/shots`.
   It exits non-zero on any failure and saves a screenshot per case.

---

## Traps we hit

| Trap | What happened | Fix |
|---|---|---|
| Live voice models hear speech in silence | Gemini Live heard "¿Qué tal?" in 25 s of quiet and switched to Spanish | One system-prompt line: always speak English unless the person clearly speaks full sentences in another language |
| HTTP 200 isn't success | Census API returned an HTML error page with status 200; a saved "fixture" was an error page | Read real rows; find a second source that can disagree |
| A label isn't content | A "current reps" layer was the stale pre-redistricting map; a "polling place" layer was for Ireland | Same: verify against primary data |
| Signed media links expire | Stored Deezer previews returned 403 by demo time | Refresh at request time; hide controls whose media fails to load |
| Hotlink protection | Oolite images returned 403 with our page as referrer | `referrerPolicy="no-referrer"` |
| Random image failures | Apple's CDN reset connections; a web-archive copy was blocked by the browser | `onError` fallback |
| Slow model in a batch | Gemma 4: 90 s per batch, drifted off the vocabulary | Gemini Flash in JSON mode for offline tagging |
| The model's list order isn't a ranking | "Mostly DJs, maybe a muralist" → `['artist','musician']` | Don't read meaning into order; rank with code |
| Slow AI on stage | A 23 s live call at Hack for Humanity | Precompute anything over about 3 s |
| Local build crashes on Windows | Turbopack panic `0xc0000142` with 37 node processes | Kill stray node; `tsc --noEmit` locally; Vercel's build is the real compile |
| Vercel built the wrong thing | Project was set to static `public/` | `vercel.json`: `{"framework": "nextjs", "outputDirectory": ".next"}` |
| A whole-file doc rewrite from a shell | Broke `ROADMAP.md`'s encoding mid-sprint | Targeted edits only |
| Shared Playwright browser locked | Another Claude session held the Playwright MCP profile | Close other sessions, or run Python Playwright with its own browser |
| Laptop slept mid-test | 4-minute run took 4.8 hours | `powercfg` (see `runbook.md`) |
| Testing animated UI | Playwright waits for moving elements to be still, forever | `click(force=True)`; compare text case-insensitively (CSS capitals change `innerText`) |
