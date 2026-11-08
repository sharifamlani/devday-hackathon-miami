# RESUME HERE: PAUSED ~12:40 PM Sun Nov 8 (Sharif traveling to the venue). Lead = devday-hackathon-fb

Freeze **4:15 PM**. Repo public + MIT ~3:15 (96 asks Sharif for a one-word yes). Process: `docs/sop/development-flywheel.md`
(QA exact sha → lead pinned merge → session 20 walks TEST → LIVE). Sharif's UI decisions win over Christian's.

## Main = 66379e9 (demo plan §22 in plan.md; demo script updated)
Merged since 9:30: #186 #188 #185 #137 #197 #194 #202 #201 #199 #187 #204 #200 #209 #203 #212 #216 #219 #222 #223 #226 #229 #230
#211 #213 (calendar v3) #214 (smooth close) #232 #234 #237 #238 #239 #241 #242 #243 #244 #245 #246 #247 #248 #249 #250 #253 #225 #236
#227 #252; Christian ungated: #195 #164 #193 #198 #206 #217 (all retro-checked PASS).

## State at pause
- LIVE (:5173/:8001, session 20): reset to the new sample data was in progress; 20 leaves it consistent (finished, or restored from
  dd-live-state/donors.live-backup-1143-PRE-RESET-sharif-desk.db). Check 20's last message.
- Public site: Vercel prod → cloudflared quick tunnel → :8401 (PUBLIC_MODE, LIVE db). Drops when the laptop sleeps (falls back to
  the snapshot). On resume: 22 restarts the tunnel; the URL changes, so the Vercel env + redeploy are needed. Sharif approved
  PUBLIC_SHOW_ALL (show everything; writes still refused) and a quiet toggle; 22's PRs are in progress.

## Open PRs
| # | What | State |
|---|---|---|
| 210 | Demo call with Hye-jin + 5K RSVP | QA by 82 [53d436] (1b was stuck) |
| 251 | Snapshot recut (fallback) | 33 recutting on 8170e03 (cold) |
| 231 | Christian: home tiles fold up | HOLD for Sharif |
| 233, 235 | Christian: sample label → menu; faster closes | CHANGES needed (9e audit); ask Sharif before commenting |
| 22's | PUBLIC_SHOW_ALL + tunnel toggle | in build |
| 33's | hide write controls in public mode | in build |
| 54's | email "prep for" slice | in build |

## Decisions recorded
80% duplicate threshold incl. Veloria (Sharif). Donor notes on gpt-6-luna. Show everything publicly (Sharif). Every sample person has
email + phone (#244, #253). D6: individuals not web-researched (Enhance) unless Sharif lifts it (one constant).

## Resume checklist
1. Send "resume" to all sessions. 2. 20: LIVE state + finish the reset if needed. 3. 22: tunnel back up + Vercel env. 4. #210 → merge →
e6 adds the call words. 5. 2:30 final rehearsal per plan.md §22. 6. ~3:15 public flip (Sharif yes) + `demo` tag. 7. 4:15 freeze.
