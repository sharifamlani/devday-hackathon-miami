# Idea shortlist: DevDay Exchange Community Hackathon: Miami

Filled in the night before. **One idea locks at kickoff, before T0**, with a #2 fallback that
reuses the same setup.

## The judges' criteria (copied word for word from `event-brief.md`)

> **Not published yet (Q3).** Score against these proxies until kickoff, then replace:
>
> - The mandate: "working AI agents and tools those organizations can actually use on Monday. Not slide decks. Shipped software."
> - Acceptance criteria: Codex · OpenAI API · OpenAI Agents SDK
> - Sibling DevDay event (Bengaluru): "usefulness, technical execution, originality, and how well the solution works"
> - The room: 2 of 9 judges are The Miami Foundation's data and grants staff
>
> Problem statements arrive at the 12 PM opening, so the candidates below are filled at K, not tonight.

**Every idea, and every reframe at the venue, is scored against these.** At Converge the event
asked for "ambition and strangeness"; a strange idea was reframed at the venue into a useful
directory, never re-scored, and didn't place.

## Score each idea 1–5

| Column | The question |
|---|---|
| **Criterion 1: Monday-usable** (× 2) | Could a nonprofit's non-technical staff run it Monday with no engineer? |
| **Criterion 2: Works + uses the stack** (× 1) | Real agent (Agents SDK tools) on real data, built in Codex? |
| **Moment** | Is there ONE live interaction that lands in 10 seconds? |
| **AI visible** | Can a judge **see** what the AI did, on screen, in the demo? |
| **Runs live** | Can the core loop run on stage by T0 + 2h30, with real input? |
| **Demo-safe** | Few moving parts in the room (Wi-Fi, mic, hardware, slow calls)? |
| **Sponsor** | Is the Agents SDK visibly doing work (tool calls on screen), not just one chat call? |

## Candidates

| # | Idea, in one sentence | The 10-second moment | Crit 1 | Crit 2 | Moment | AI visible | Runs live | Demo-safe | Sponsor | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |

## Pre-kickoff candidates (written Sat Nov 7 morning)

These are **shapes, not final picks**. The problem statements arrive at K, so at K map each prompt onto
the closest shape and re-score it. Inputs: the Nov 6 team brainstorm (`transcripts/`), the judges list,
and the Miami Foundation research below.

**What the research says about the room**
- **Give Miami Day 2026 is Thu Nov 19** (early giving Sat Nov 14 to Wed Nov 18), run by The Miami Foundation,
  the title sponsor. "Usable Monday" is literally true: Monday Nov 9 starts the prep week. More than half
  of participating nonprofits have budgets under $250K, which means no development staff.
- Judges Kessell (data and engagement) and Mohan (grants administration) read grant applications and
  reports for a living. Grant work is their own pain, so they will recognize it fast.
- The Foundation's Community Grants are general operating support ($40K to $70K over two years). Anni's
  point from the brainstorm stands: most nonprofit money is **restricted**, so knowing what can be spent
  where is a real operations problem.
- 2025 to 2026 federal cuts (refugee programs, DOJ, FEMA EFSP, AmeriCorps, SNAP) hit South Florida
  nonprofits hard. That gives the "why now" for the fundraising ideas (Faye's domestic-violence client).

| # | Idea, in one sentence | The 10-second moment | Crit 1 | Crit 2 | Moment | AI visible | Runs live | Demo-safe | Sponsor | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| A | **Give Miami Day Campaign Kit**: paste a small nonprofit's URL and one client story, and an agent builds its full giving-day kit (countdown emails, posts, thank-you notes) in English, Spanish and Haitian Creole | URL in, then 12 dated, ready-to-send pieces for Nov 14 to 19, each tied to a fact pulled from their own site | 5 (×2) | 4 | 5 | 5 | 5 | 5 | 4 | **38** |
| B | **Grant Report Autopilot**: drop in the program spreadsheet and the funder's report questions, and an agent drafts the report with every number linked to the row it came from | Messy CSV in, then a funder report where clicking "212 families served" highlights the rows that sum to it | 5 (×2) | 4 | 4 | 5 | 5 | 5 | 4 | **37** |
| C | **Restricted-Funds Navigator** (Anni's 4% point): upload the grant agreements and an expense list, and an agent pulls out each restriction and assigns every expense to a grant it can legally go to | Three grant PDFs plus expenses, then "You can still spend $8,400 on rent; Grant X forbids it, Grant Y allows it (§4.2)" | 4 (×2) | 4 | 5 | 5 | 4 | 5 | 4 | **35** |
| D | **Funder Scout** (Faye's and Carlos's idea): enter the mission, and an agent searches IRS 990 data for foundations that already fund similar South Florida work, ranks them by expected value (chance × amount ÷ effort, Carlos's Annie Duke framing) and drafts the first letter of inquiry | Mission in, then a ranked list with "Gave $50K to a Miami DV shelter in 2024 (990 Schedule I)" on every card | 4 (×2) | 5 | 4 | 5 | 3 | 4 | 5 | **34** |
| E | **Community Resource Navigator** (Anni's "community problem" angle): a resident speaks in Spanish or Creole ("I lost SNAP, I have two kids"), and an agent matches them to the nonprofit's own service list and writes a referral | Voice question in Creole, then three nearby services with hours and what to bring | 3 (×2) | 4 | 5 | 4 | 3 | 2 | 4 | **28** |
| F | **Split-the-dollar portfolio** (Christian's favorite): a donor picks causes and exclusions and gets a split across vetted local nonprofits | "$20/month: cancer and immigrant rights," then a split with a reason for each | 2 (×2) | 3 | 3 | 3 | 4 | 4 | 3 | **24** |

**Notes on the scores**
- **D** has the strongest stack story and fits the team's original idea, but its "Runs live" score depends
  on data. ProPublica's Nonprofit Explorer API gives org-level 990 totals, while the grant-by-grant detail
  (Schedule I, 990-PF) sits in IRS XML filings. **Before choosing D, `data-prober` must show that South
  Florida grantee lines can be pulled in under 30 minutes.**
- **F** is a two-sided marketplace that needs payment rails. It is hard to make it usable for a nonprofit
  by Monday. It works better as a donor-facing tab inside A than as an entry of its own.
- **E** has the most "fancy" demo appeal, as Anni put it, but the most risk on stage (live mic, venue
  noise, liability in referrals). The voice interviewer could be reused from the kit if a prompt calls for it.

**Mapping at K (prompt type → shape):** fundraising or donors → A, then D · reporting, compliance or
operations → B, then C · residents, services or access → E · volunteers or outreach → A's engine
pointed at volunteers.

**Fallback pairing:** A and B share one engine (an Agents SDK agent with a "read the org's documents"
tool, a "draft" tool and a "cite the source" tool), so either one can fall back to the other without
new setup.

## Reframes at the venue

| Time | Reframe | Re-scored total | Kept? |
|---|---|---|---|
| | | | |

## Locked

**Idea:** · **Name:** · **Locked at:** (target: before T0) · **Fallback:**
