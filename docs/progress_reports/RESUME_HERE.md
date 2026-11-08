# RESUME HERE: state at ~9:30 AM Sun Nov 8 (lead = session devday-hackathon-fb)

Freeze **Sun Nov 8, 4:15 PM ET**. Repo public + MIT ~3:15 PM (96 asks Sharif for a one-word yes first; history stays as is,
Sharif OK'd the phone number in PR #139 refs and docs/judges.md in history). Tunnel (#137) merged but OFF until Sharif says go.
Process: `docs/sop/development-flywheel.md` (Define → Build → QA exact sha → lead pinned merge
`gh pr merge N --merge --match-head-commit <sha>` → Integrate + live test by session 20 → Loop). Christian merges without the
gate sometimes: give each a retro review + a live walk (done for #193 #164 #195 #198 #206, all PASS).

## Main = 043a82a (walk 16: 16/16 from empty; merge-all → 33 givers / 131 gifts / $1,367,535; 4 events)
Merged this morning: #189 snapshot, #190 send-card notes, #176 #207 demo script, #191 files open, #192 agent-walk cases,
#186 Impact panel, #188 GMD gave-via, #185 count-once, #137 tunnel switch (off), #197 two cards, #194 draft→donor,
#202 dictation feedback, #201 receipt waits for click, #199 call-today order. Christian: #195 #164 #193 #198 #206.

## Open PRs (reviewer)
| # | What | Owner | Reviewer / state |
|---|---|---|---|
| 187 | keyboard shortcuts (head 6933acc) | 9e | 82 [2fce76] checking conflict resolution; MERGE BEFORE #204 |
| 204 | home polish + Impact & story card (694c925) | 9e | in-session reviewer; rebase onto #187 after |
| 200 | CRM givers only + collapsible filters | 9e | in-session reviewer |
| 209 | CRM row expands inline (Sharif high priority), stacked on #200 | 9e | same reviewer as #200; retarget to main after #200 |
| 212 | Files & drafts refetch after agent drafts | 9e | db |
| 196 | Review opens saved invites (57 s → <1 s) | e6 | a4 |
| 208 | events 4/4 (5K never dropped) | e6 | 19 |
| 210 | demo call → Hye-jin, RSVP to the 5K | 3c | 1b (strict) |
| 203 | live-streaming home chat | 54 | 82 [53d436]: CHANGES (rebase + spinner finalize) |

## In build
- 54: agent fixes duplicates in chat (Sharif rule: ≥80% auto-merge, no card, undoable; <80% asked in chat). Asked Sharif
  whether Veloria Bay (0.8) should auto-merge. Plus call-sheet protocol (subagent, PHONE_CALLS off).
- 96: agent-written donor summary ("About <donor>", summary / summary_updated_at / summary_sources on GET /donors/{id}).
- 33: Calendar v3 service (events API, migration, agent calendar tools); 9e builds the web half.
- 0f: README audit (66/66 claims mapped; models gpt-6.1-sol / gpt-6-luna named); PR by ~1 PM.
- e6: script follow-up after #210 (call step + "If it's slow" line).
- 20: LIVE CONTEXT_DEADLINE_S → 45 (reads are 25–31 s vs 30 s deadline).

## Sharif's open decisions
Public flip go (~3:15) · tunnel ON timing · Veloria Bay auto-merge threshold · phone "Find a donor" box · rotate API key after.

## Incidents today
LIVE node_modules broken ~08:00 by a junctioned worktree (54), restored; fleet rule: never junction to dd-live-main /
dd-live-test. Root .env went missing, restored by 96 from an identical copy. Lead's reviewer deleted packages in
wt/port-101 through a junction; restored with npm install.
