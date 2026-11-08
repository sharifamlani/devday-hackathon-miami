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

**Ask in snapshot mode** (`askHosted.ts`): the example questions and chip edits are answered in the
browser. Any other question is POSTed to the Vercel Function `web/api/ask.ts` as `{question, as_of}`;
it returns only a filter (the model never sees donor rows) and `applyAskFilter` runs it over the
snapshot. Without `OPENAI_API_KEY` on the Vercel project it answers 503 and the page says live AI
isn't configured. Under `vite dev` there is no `/api`, so free text gets a "couldn't answer" fallback.

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
- `ContextRunInput`: `{ website, x_url?, linkedin_url?, instagram_url?, refresh? }`. **`website` is required**
  (lead decision): a run without it fails and a failed run saves nothing, so socials typed without a
  website would be dropped. Empty social fields are sent as `null`.
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
| Research without a website | `"Add your website to continue"`, thrown before any request (both modes) | Mark Website as required and disable "Continue" until it's filled; the message is the backstop |
| Upload before ingest is running (404/503) | `"Upload isn't available yet: the ingest service is not running."` | The message |
| Research before the context service is running (503) | `"Website research isn't available yet: …"` | The message |
| Research ran but the live read failed or timed out | `served_from: "fallback"` | "Showing saved context", with `detail` as a tooltip |
| Draft email on a dismissed prospect (409) | `"This prospect was dismissed, so no email is drafted."` | **Hide or disable "Draft email" when `prospect.status === "dismissed"`.** The message is only a backstop: Chromium logs the 409 as a console error, which fails QA's 0-console-error bar |
| A Phase 5E route that hasn't landed (503, or the bare 404) | `"The calendar isn't available yet: …"` (likewise the people list, community stats, chat, sending) | The message. Until a route lands, calling it also logs a console error, so keep that screen behind a flag |
| Send without an approver | `"Add who is approving before sending."`, before any request | The message |
| Snapshot mode + research | Simulated, instantly done, `served_from: "cache"` | "Cached sample"; the website shows "no saved context" if the snapshot has none |

Live timings: list < 2 s, research < 1 s (cached), outreach about 11 s, website context up to 30 s. Always show a busy state on agent buttons.

## 6. Rules the screens must keep (plan.md §3)

1. **SAMPLE DATA stays visible.** Individual donors are fictional, and org gift amounts are invented.
2. **★ donors and prospects are never sent automatically.** A person approves and sends.
3. **Every researched fact shows its source link** (`source_url`). No URL, no fact: the parser already drops them.
4. **Never present a number the API didn't send.** Scores, fit scores, day counts and stats come from Python.
5. **Prospects are organizations only**, never private individuals.

## 6b. Three tabs, calendar, community stats and chat (plan.md §17, Phase 5E)

Tabs are locked: **Givers · Neighbors · Community** (`Tab` = `"giver" | "neighbor" | "community"`; use
`TAB_LABELS` for the words). Hooks live in `crmHooks.ts`:

```tsx
import {
  usePeople, useSetTab, useEvents, useEvent, useCommunityStats, useChat, useApproveSendBatch,
} from "@/components/atomic-crm/providers/local/crmHooks";
import { TAB_LABELS, NOT_RECORDED } from "@/components/atomic-crm/providers/local";

const { data } = usePeople("community");   // data.people, data.counts.{giver,neighbor,community}
const move = useSetTab();                    // move.mutate({ personId, tab: "giver" })

const chat = useChat({ screen: "giver" });   // or "neighbor" | "community" | "calendar"
chat.send("Who should I call before Give Miami Day?");
// chat.messages[i].steps → [{ label: "Found people", summary: "3 lapsing", status }]
// chat.pendingBatch      → { id, items, bulk_approvable, needs_individual_approval, flagged }
const approve = useApproveSendBatch();
approve.mutate({ batchId: chat.pendingBatch!.id, approvedBy: "Philanthropy team (demo)" });
// then chat.resolveBatch(batchId)
```

| Hook | Returns `data` | Notes |
|---|---|---|
| `usePeople(tab)` | `PeoplePage` = `{ people, counts, needs_review }` | `counts` feeds the tab badges; a count is `null` if the API didn't send it |
| `useSetTab()` | mutation `{ personId, tab }` | One-click move between tabs |
| `useUploadFiles()` | mutation `{ files, target? }` | `target`: `"giver" \| "neighbor" \| "community" \| "auto"` (default: the agent sorts) |
| `useEvents()` | `CrmEvent[]` | Soonest first; each has `source_url` |
| `useEvent(id \| null)` | `CrmEventDetail` | `recipients` (with `reason`, e.g. "tagged: has a dog") and pre-drafted `drafts` |
| `useCommunityStats()` | `CommunityStats` | `breakdowns: [{ dimension, buckets: [{ label, count }] }]`, `trends`, `total` |
| `useChat(context)` | `{ messages, send, isPending, error, pendingBatch, resolveBatch, reset }` | Conversation lives in component state |
| `useApproveSendBatch()` | mutation `{ batchId, approvedBy, perItem? }` → `SendResult` | `{ sent, skipped, blocked: [{ id, reason }], simulated }` |
| `usePlanEventOutreach()` | mutation `eventId` → `{ batch_id, total, bulk_approvable, needs_individual_approval, flagged }` | Calendar **"Review"**: drafts the event's invites as a batch (if not yet), then open the chat panel on `batch_id` |
| `useSendBatch(batchId \| null)` | `SendBatch` | Load a batch by id (e.g. `event.batch_id`) for the chat panel's approval card |
| `useContextStatus()` | `ContextStatus` | Show `data.label`: "Context updated today 7:00 AM · 2 new events" (also "Updating context…", "Context not updated yet") |
| `useRefreshContext()` | mutation → `ContextStatus` | "Refresh now". Can take ~16 s like a live context run; use `isPending`. Context, events and status refetch after |

**Types (`crmTypes.ts`):**
- `Person`: `id`, `name`, `org_name`, `tab`, `email`/`phone` (raw from the local API: show them only inside the app), `city`, `tags` (the API's `interests`), `has_dog` (`null` = not recorded), `demographics: [{ label, value }]` (Community lists **every** field — age range, gender, household size, zip, language, programs — with "not recorded" for missing ones; other tabs list only recorded ones), `is_sample`, Givers' `score`/`tier`/`is_star`/`status`, `needs_review` + `review_reason` (the API's `tab_review`: an unclear sort or a cross-file duplicate; show it for one-click review). `last_touch`/`next_step` aren't sent yet (always `null`).
- `CrmEvent`: `title`, `starts_at`, `ends_at`, `place`, `audience` (the API's `audience_hint`), `status` (`upcoming | changed | past`), `kind`, `rationale` (why this audience), `batch_id` (the event's pending batch, once planned), `source_url`, `audience_count`, `drafts_ready`. Lists keep the server's order: upcoming soonest first, then past.
- `SendItem` (an invite or a chat draft): `name`, `tab`, `channel` (`"email" | "text"`), `to`, `subject`, `body`, `facts_used`, `needs_individual_approval` + `approval_reason`, `flags`, `status`.
- `ChatMessage`: `{ role, text, steps, batch, demo }`. `demo: true` marks the canned snapshot run.

**Approval rules (the data layer enforces them too):**
- A bulk approval (no `perItem`) sends only items with `needs_individual_approval: false` and no `flags`.
- ★, big-tier and organization items go only when listed in `perItem` as `{ id, approve: true }`.
- Flagged items never go until a person edits them. `{ id, approve: false }` skips an item.
- `approvedBy` is required; a blank name is rejected before any request.

**Copy rules (non-negotiable, plan.md §17):**
1. **Community never shows a donation ask.** No "give", "donate" or "support us" buttons, banners or draft
   templates on the Community tab or in its messages; it's about programs and help.
2. **Sends always need approval.** No screen sends on its own. Every send goes through `useApproveSendBatch`
   with a named approver, and the button says what happens ("Approve and send 3").
3. **Missing demographics read "not recorded".** Use `NOT_RECORDED`; never leave a blank, guess, or infer.
   Stats already merge null, empty and "unknown" into one "not recorded" bucket, kept last.

**Social posting is "Coming soon":** `SOCIAL_POSTING` (from `config.ts`, re-exported by the package) is
`"coming_soon"`. Render "Post to Instagram / LinkedIn / X" as a **disabled** action labeled "Coming soon".
Nothing in the data layer posts to any social network, and no hook exists for it yet.

```tsx
import { SOCIAL_POSTING } from "@/components/atomic-crm/providers/local";
<Button disabled={SOCIAL_POSTING === "coming_soon"}>Post to Instagram · Coming soon</Button>
```

**Calendar → chat:** the Calendar's "Review" button calls `usePlanEventOutreach().mutate(event.id)` (skip it if
`event.batch_id` is already set), then opens the chat panel on the returned `batch_id`; the panel loads it with
`useSendBatch(batch_id)` and approves with `useApproveSendBatch` like any chat batch.

**Snapshot mode:** reads `people` (`{counts, giver, neighbor, community}`), `events` + `event_details` and `community_stats`; "Review" builds a demo batch from the event's drafts (approve applies the rules in memory); the context status is the
snapshot's own `context_status` key or its export time labeled "Cached sample" (never a live refresh), and
"Refresh now" is refused (read-only). Until `people` exists, Givers
falls back to the snapshot's donors and the other tabs are empty; a missing `events` key means an empty
calendar, never invented events. Chat returns a **canned run labeled "Demo run (cached sample)"** built
from the snapshot's real drafts (or a recorded `chat_demo` key). Approving it applies the same rules in
memory, and nothing is sent. Tab moves are refused (read-only).

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
| `validate.ts` | Client-side checks (website required) |
| `crmTypes.ts` / `crmParse.ts` | Phase 5E types and parsers (tabs, events, stats, chat) |
| `crmHttp.ts` / `crmSnapshot.ts` | Phase 5E methods for local and snapshot mode |
| `crmHooks.ts` | Phase 5E hooks |

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

- Phase 5E routes: `/people`, `/events`, `/community/stats`, `/context/status` are in 8b's PR #60 (this
  layer matches its shapes); `/chat` and `/send` in 90's PR #58; `/events/{id}/plan` and `/context/refresh`
  aren't built yet (guarded). Until a route is on :8000, its hook shows the friendly "isn't available
  yet" message.

- ICP + prospects: walked on 8b's populated snapshot (5 traits, 7 prospects). Prospect first-touch
  drafts are `null` until 86's draft_prospect lands, so design the "no draft yet" state.
- Live, GET /icp answers 404 before a profile exists. The data layer returns `null`, but Chromium still logs
  the 404 as a console error; asked the service to answer 200 `null` instead (both work here).
- Onboarding: POST /context/run is in PR #21 and not on :8000 until 86's build_context lands, so
  `useRunContext()` shows the 503 message until then. The snapshot `context` is empty until then too.
- Upload sends files under the form field `files`. Carlos's router decides the real name; one line in
  `httpClient.ts` (`uploadFiles`) changes if it differs.
- Run the tests: `npx vitest run --config vitest.config.ts --project app src/components/atomic-crm/providers/local`.
