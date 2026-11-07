# Donor Desk data layer (`providers/local/`)

Everything the Donor Desk screens show comes through this folder: donors, scores, research, drafts,
duplicates, the ideal donor profile (ICP) and prospects. Use the **hooks** for screens, read the
**types** for field names, and you never need to know whether the data came from the live API or the
static snapshot.

## 1. The two data modes

| `VITE_DATA_MODE` | Reads from | Writes (merge, approve, …) | Use it for |
|---|---|---|---|
| `snapshot` (default) | `web/public/snapshot.json`, from `python -m service.export_snapshot` | Change only this browser tab's copy. Agents can't run | Vercel, offline fallback |
| `local` | The Python API at `VITE_API_URL` (default `http://localhost:8000`) | Saved in `data/donors.db` | The demo laptop |

Set them in `web/.env.local` (gitignored); `web/.env.example` lists every variable:

```bash
VITE_DATA_MODE=local
VITE_API_URL=http://localhost:8000
VITE_SNAPSHOT_URL=./snapshot.json
VITE_APPROVER_NAME=Philanthropy team (demo)   # recorded as approved_by
```

The service's CORS allows `localhost:5173` and `5174`, so run `npm run dev -- --port 5173` in local mode.
Both modes use the same parser (`parse.ts`), so a screen that works on one works on the other.

## 2. Quick start

The hooks use react-query plus the ra-core data provider, so call them from inside `<CRM>` (see
`root/DonorDesk.tsx`, which already passes `dataProvider` from this folder).

```tsx
import {
  useDonors, useDonor, useDraftOutreach, useApproveDraft,
} from "@/components/atomic-crm/providers/local/hooks";

const CallList = () => {
  const { data: donors, isPending, error } = useDonors(); // highest score first
  if (isPending) return <Spinner />;
  if (error) return <p>{error.message}</p>;
  return donors.map((d) => (
    <Row key={d.id} name={d.full_name} score={d.score} why={d.why_short} star={d.is_star} />
  ));
};

const DraftBox = ({ donorId }: { donorId: number }) => {
  const { data: donor } = useDonor(donorId);
  const draft = useDraftOutreach(donorId);   // POST, about 11 s live
  const approve = useApproveDraft();
  return (
    <>
      <button onClick={() => draft.mutate()} disabled={draft.isPending}>
        {draft.isPending ? "Drafting…" : "Draft email"}
      </button>
      {draft.isError && <p>{draft.error.message}</p>}
      {donor?.draft && (
        <button onClick={() => approve.mutate({ draftId: donor.draft!.id, body: donor.draft!.body })}>
          Approve
        </button>
      )}
    </>
  );
};
```

After any write the hooks refetch everything, so lists, ranks and drawers update by themselves. Never
read a POST's response yourself.

Onboarding (plan.md §15): screen 1 uploads files, and screen 2 saves the org's URLs and researches its
website. Only the website is researched; social URLs are saved and come back "saved, not connected".

```tsx
import { useUploadFiles, useRunContext } from "@/components/atomic-crm/providers/local/hooks";

const upload = useUploadFiles();
upload.mutate(Array.from(input.files ?? []));          // multipart POST /ingest
// upload.data → { donors, gifts, duplicates, message, raw }

const research = useRunContext();                     // one call, up to 30 s
research.mutate({ website, x_url, linkedin_url, instagram_url });
// research.isPending → "Reading your website…"
// research.data.sources → [{ label: "Website", state: "done", fact_count: 12 },
//                          { label: "X", state: "saved_not_connected", status_text: "saved, not connected" }, …]
// research.data.served_from → "live" | "cache" | "fallback"
//   "fallback" (live read failed/timed out): show "Showing saved context", detail as a tooltip
```

Outside React (a script or test), call the same functions directly:
`import { donorDeskMethods } from "@/components/atomic-crm/providers/local"`.

## 3. Hooks (`hooks.ts`)

| Hook | Returns `data` | Notes |
|---|---|---|
| `useDonors()` | `DonorSummary[]` | Highest score first |
| `useDonor(id \| null)` | `DonorDetail` | Disabled while `id` is null (drawer closed) |
| `useDuplicates()` | `DuplicatePair[]` | Pending pairs only |
| `useMergeDuplicate()` | mutation `{ pairId, keepId }` | Keeps `keepId`, moves the other record's gifts into it, rescores |
| `useDismissDuplicate()` | mutation `pairId` | "Keep separate" |
| `useEnrichDonor(id)` | mutation | Research agent; facts appear in `donor.research` |
| `useDraftOutreach(id)` | mutation | Outreach agent; the draft appears in `donor.draft` |
| `useApproveDraft()` | mutation `{ draftId, body }` | Any draft, donor or prospect. `body` is the edited text |
| `useSourceLabel()` | `string \| null` | `"Cached sample"` in snapshot mode, `null` live |
| `useIcp()` | `IcpProfile \| null` | `null` until the ICP has been built |
| `useRunIcp()` | mutation | Rebuild the ICP (live only) |
| `useProspects()` | `ProspectSummary[]` | Highest fit first |
| `useProspect(id \| null)` | `ProspectDetail` | |
| `useDraftProspectOutreach(id)` | mutation | First-touch email; the draft appears in `prospect.draft` |
| `useDismissProspect()` | mutation `id` | |
| `useUploadFiles()` | mutation `File[]` → `IngestResult` | Screen 1. Everything refetches after |
| `useRunContext()` | mutation `ContextRunInput` → `ContextRun` | Screen 2. Synchronous, up to 30 s; `isPending` is the progress state |
| `useOrgContext()` | `OrgContext` | Saved profile + website facts, newest first |
| `useOrgProfile()` | `OrgProfile \| null` | `null` until the org has entered its URLs |

Mutation callbacks: use `await mutation.mutateAsync(...)` (try/catch) when the component may unmount
on success, for example a dialog that closes. react-query drops `mutate(..., { onSuccess })`
callbacks after an unmount (`contacts/DuplicateMerge.tsx` shows the pattern).

## 4. Types (`types.ts`)

All the numbers come from Python (`score.py`, the ICP stats). The UI displays them and never computes a
score.

**`DonorSummary`** (one row of the call list)

| Field | Type | Example / meaning |
|---|---|---|
| `id`, `full_name` | number, string | `1`, `"Maria Delgado"` |
| `org_name`, `donor_type` | string\|null, `"individual" \| "organization"` | |
| `email`, `city`, `fund_type` | string\|null | `"Donor Advised"` |
| `tier` | `"big" \| "mid" \| "small"` | |
| `is_star` | boolean | ★ Shack Society level ($1M+ lifetime). **Never auto-sent** |
| `is_sample` | boolean | Gift history is invented: show a "Sample history" badge |
| `score` | number 0–100 | `89` |
| `status` | `"lapsing" \| "due" \| "on_track" \| "lapsed" \| "no_gifts"` | |
| `why_short` | string | `"gave on Give Miami Day 2022–2025; not yet in 2026 · Give Miami Day in 11 days"` |
| `last_gift_date`, `last_gift_amount` | string\|null, number\|null | `"2025-11-20"`, `3000` |
| `usual_cadence` | string\|null | `"yearly · Nov"`, `"quarterly"`, `"yearly (assumed)"` |
| `gift_count`, `total_given` | number | |
| `give_miami_day_days_away` | number\|null | From the data. Never hard-code "N days" |

**`DonorDetail`** = `DonorSummary` plus:

| Field | Type | Meaning |
|---|---|---|
| `why` | string | A plain sentence written from score.py's numbers. **Not written by an LLM**: caption it as computed |
| `score_factors` | `{ label, points, max, detail }[]` | Urgency /55, Value /25, Frequency /12, Engagement /8; the points add up to `score` |
| `gifts` | `{ id, amount, gift_date, channel, fund_type }[]` | Newest first |
| `research` | `{ id, fact, source_url, retrieved_at }[]` | From the research (enrich) agent. Every fact has a URL; show it as a link |
| `draft` | `OutreachDraft \| null` | The newest draft |
| `phone`, `notes` | string\|null | |

**`OutreachDraft`**: `id`, `channel`, `subject`, `body`, `call_script`, `facts_used: { fact, source_url }[]`,
`status` (`"draft"` = a human must send, used for ★ donors, orgs and prospects; `"ready"` = may auto-send
once approved; `"approved"`; `"sent"`), `approved_by`, `approved_at`.

**`DuplicatePair`**: `id`, `reasons: string[]` (`"same email: x@y.org"`), `confidence` (0–1),
`donors: [DuplicateDonor, DuplicateDonor]`, where each has `id`, `full_name`, `email`, `city`, `gift_count`, `total_given`.

**`IcpProfile`**: `id`, `created_at`, `traits: IcpTrait[]`, `stats: IcpStat[]`, `evidence: IcpEvidence[]`.
- `IcpTrait`: `{ label, value, evidence }`, e.g. `{ label: "Causes funded", value: "youth, climate", evidence: [...] }`
  (the API sends `{trait, value, evidence}`; `label` is the API's `trait`, and `matched_traits` on a prospect uses the same labels)
- `IcpStat`: `{ label, value }`, already formatted as text, e.g. `{ label: "Median gift", value: "50,000" }`
- `IcpEvidence`: `{ donor, fact, source_url }`: which current donor shows the trait, and where it's sourced
- `recent_context: DatedFact[]`: the newest org facts the ICP leaned on, `{ source, fact, source_url, posted_at }`

**`ProspectSummary`**: `id`, `name`, `org_type` (`"company"`, `"foundation"`, …), `city`, `fit_score`
(0–100, Python), `matched_traits: string[]` (ICP trait labels), `priority` (the Foundation priority it
fits), `status` (`"new" \| "drafted" \| "dismissed"`), `facts: { fact, source_url }[]`,
`fit_breakdown: { label, points }[]` (why it scored what it did; biggest first, sums to `fit_score`, e.g.
"Priority overlap" 22, "Geography" 12) and `matched_context: DatedFact[]` (org facts it lines up with).
**`ProspectDetail`** adds `created_at` and `draft: OutreachDraft | null` (always status `"draft"`).

**Onboarding types**
- `OrgProfile`: `name`, `website`, `socials: SocialLink[]` (only the ones entered), `priorities: string[]`,
  `voice: string[]`, `updated_at`.
- `SocialLink`: `{ platform: "x" | "linkedin" | "instagram", label, url, connected, status }`. Today
  `connected` is `false` and `status` is `"saved, not connected"`.
- `ContextFact`: `{ id, source, source_url, posted_at, fact, quote, priority }`. `quote` holds the exact words the fact was verified against.
- `OrgContext`: `{ profile, facts, cached }`.
- `ContextRunInput`: `{ website, x_url?, linkedin_url?, instagram_url?, refresh? }`. Empty strings are sent as `null`.
- `ContextRun`: `{ status: "done" | "failed", served_from, cached, detail, sources, profile, facts, finished_at }`.
  `served_from` is `"live"` (the site was read), `"cache"` (a cache read on request, the fast stage path)
  or `"fallback"` (the live read failed or timed out). `cached` is `true` only for `"fallback"`.
- `ContextRunSource`: `{ source, label, state, status_text, fact_count, detail }`, where `state` is
  `"done" | "blocked" | "failed" | "not_provided" | "saved_not_connected"`. Show `status_text` (the API's
  own words) and put `detail` (block reason, or the saved URL for socials) in a tooltip.
- `IngestResult`: `{ donors, gifts, duplicates, message, raw }`. Counts are `null` when the ingest service
  doesn't report them, and `raw` is the full response.

## 5. Errors and slow calls

| Situation | What you get | Show |
|---|---|---|
| Any failed call | `error.message`, e.g. `"POST /drafts/5/approve failed: 422 …"` | The message, inline |
| Outreach takes > 90 s (504 `agent_timeout`) | `"Draft took too long, showing the last saved draft."` (or "…no saved draft yet. Try again.") | The message; the saved draft appears by itself |
| Approve with a blank name | 422 from the API | The message |
| Snapshot mode + an agent action | `"This is a read-only snapshot. Running the agents needs the local API."` | The message |
| Snapshot mode + approve | Succeeds in memory only | "Demo only: not saved (cached sample)" |
| Upload before ingest is running (404/503) | `"Upload isn't available yet: the ingest service is not running."` | The message |
| Research before the context service is running (503) | `"Website research isn't available yet: …"` | The message |
| Research ran but the live read failed or timed out | `served_from: "fallback"` | "Showing saved context", with `detail` as a tooltip |
| Draft email on a dismissed prospect (409) | `"This prospect was dismissed, so no email is drafted."` | **Hide or disable "Draft email" when `prospect.status === "dismissed"`.** The message is only a backstop: Chromium logs the 409 as a console error, which fails QA's 0-console-error bar |
| Snapshot mode + research | Simulated, instantly done, `served_from: "cache"` | "Cached sample"; the website shows "no saved context" if the snapshot has none |

Live timings: list < 2 s, research < 1 s (cached), outreach about 11 s, website context up to 30 s. Always show a busy state on agent buttons.

## 6. Rules the screens must keep (plan.md §3)

1. **SAMPLE DATA stays visible.** Individual donors are fictional, and org gift amounts are invented.
2. **★ donors and prospects are never sent automatically.** A person approves and sends.
3. **Every researched fact shows its source link** (`source_url`). No URL, no fact: the parser already drops them.
4. **Never present a number the API didn't send.** Scores, fit scores, day counts and stats come from Python.
5. **Prospects are organizations only**, never private individuals.

## 7. Files

| File | Role |
|---|---|
| `hooks.ts` | react-query hooks: what screens use |
| `types.ts` | The view model: what screens render |
| `index.ts` | Merges these methods into the ra-core data provider; `useDonorDesk()` |
| `config.ts` | Env vars: mode, API URL, snapshot URL, approver name |
| `parse.ts` | The one parser from API/snapshot shapes to `types.ts` (+ `parse.test.ts`) |
| `apiTypes.ts` | Raw API and snapshot shapes (`service/routes_data.py`, `export_snapshot.py`) |
| `httpClient.ts` | Local mode: fetch calls, error and timeout handling |
| `snapshotClient.ts` | Snapshot mode: reads `snapshot.json`, keeps writes in memory |

Reference screens built on this layer (replace freely): `dashboard/CallToday.tsx`,
`contacts/DonorDrawer.tsx` (+ `ScoreWhyPanel`, `ResearchPanel`, `OutreachPanel`),
`contacts/DuplicateMerge.tsx`.

## 8. Snapshot keys

`snapshot.json` mirrors the GET routes: `meta`, `donors` (GET /donors), `donor_details` (`{"<id>": GET
/donors/{id}}`), `duplicates`, and since PR #15 `icp` (GET /icp, or null), `prospects` (GET /prospects,
no drafts, dismissed excluded) and `prospect_details` (`{"<id>": GET /prospects/{id}}`, with drafts).
With onboarding, `context` (`{profile, facts}` = GET /org-profile + GET /context). Older snapshots
without these keys give `null` / `[]`.

## 9. Open items

- ICP + prospects: walked on 8b's populated snapshot (5 traits, 7 prospects). Prospect first-touch
  drafts are `null` until 86's draft_prospect lands, so design the "no draft yet" state.
- Live, GET /icp answers 404 before a profile exists. The data layer returns `null`, but Chromium still logs
  the 404 as a console error; asked the service to answer 200 `null` instead (both work here).
- Onboarding: POST /context/run is in PR #21 and not on :8000 until 86's build_context lands, so
  `useRunContext()` shows the 503 message until then. The snapshot `context` is empty until then too.
- Upload sends files under the form field `files`. Carlos's router decides the real name; one line in
  `httpClient.ts` (`uploadFiles`) changes if it differs.
- Run the tests: `npx vitest run --config vitest.config.ts --project app src/components/atomic-crm/providers/local`.
