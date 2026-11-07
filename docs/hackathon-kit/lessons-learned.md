# Lessons learned: two hackathons, one win, one loss

| Event | Date | Result | Full write-up |
|---|---|---|---|
| Hack for Humanity: Miami | Sat Oct 10, 2026 | 🏆 **Grand Champion** | `../lessons-from-hack-for-humanity.md` |
| Converge: Creative Tech Buildathon | Thu Oct 15, 2026 | Did not place | `../lessons-from-converge.md` |

Same team core, same tools, same playbook, five days apart. The engineering was about equal
(76 commits vs 112). **What decided it was the first hour and the last thirty minutes.** The winner
knew what the judges weighted and what the demo would show before writing code. The loser found
out on stage.

The rules below are ordered by how much they cost us when we skipped them.

---

## The 12 rules

### 1. Lock the idea before the build clock starts

| Won | Lost |
|---|---|
| Locked 1h20m in, and that was the most expensive delay of the day | Locked ~1h45m in. **Zero commits from 4:30 to 5:54.** The team reframed the idea at the venue, after the build had started |

Bring a scored shortlist. Any team reframe happens **at kickoff, before the build window opens**.
Target: idea locked and named within 20 minutes of the build starting, at the latest.

### 2. Score the idea against the judges' stated criteria, and re-score every reframe

| Won | Lost |
|---|---|
| The organizer's repo showed a weighted rubric (impact 30%, originality only 15%); we built to it | The event asked for "ambition and **strangeness**". The strange shortlist idea was reframed into a useful talent directory and never re-scored |

Write the criteria at the top of the shortlist. Every candidate, and every reframe, gets a score
against them. A good product pitched at the wrong criterion loses to a weaker product pitched at
the right one.

### 3. Get the rules in writing at kickoff

| Won | Lost |
|---|---|
| Three stacked prizes, a weighted rubric, five required README sections: all found by reading the organizer's own source | The 8 kickoff questions were never answered or written down; the peer vote surprised us |

One named person owns the kickoff questions (`templates/event-brief.md`) and commits the answers
before building starts: demo length, submission method and deadline, criteria and weights, sponsor
prizes, code-during-event rule, team size, **how voting works**, projector and Wi-Fi.

### 4. The demo script is the spec, and it is written before any code

| Won | Lost |
|---|---|
| Written first, updated with every change to the click order, Q&A answers prepared | `demo-script.md` stayed a blank template. Three tracks built their own best version and met at 8:01 |

No sentence in the script, no feature. The script names **the one moment** and **where the AI is
visible**. It is the first file written after the idea locks.

### 5. Make the AI's work visible on screen

| Won | Lost |
|---|---|
| Every AI claim carried a quote checked word for word, a link, and a visual "said it" vs "party guess" | The AI listened to 831 songs and looked at 1,383 portfolios, and none of it was on screen |

If the judges can't see what the model did, it didn't happen. One line of AI output on the card
("heard: dark, hypnotic, 128 BPM") is worth more than a thousand rows behind it.

### 6. Spend on the moment, not the breadth

| Won | Lost |
|---|---|
| One path, demoed where the data was strong | 10+ scrapers, 4 AI coding passes, 4,000 creatives, 3 rooms, in a 60-second demo |

Breadth is invisible in a short demo. Depth on one path reads as finished.

### 7. Deploy the empty app the moment the idea locks

Won: live at 1h30m. Lost: 2h06m (late only because the idea was late). Both times every later deploy
was routine. A one-line scaffold on the real URL removes a whole class of last-minute failures.

### 8. Thin slice first, then the AI, then the polish

Real input → real processing → real output on screen, end to end, before anything clever. Every
commit after the thin slice has a demo. (Won: thin slice live at 12:34, AI at 12:52, voice at 1:01.)

### 9. Integrate continuously, and freeze for real

| Won | Lost |
|---|---|
| One spine, held by one session, serially | A 3D-rooms branch merged 6 times; matches wired into the rooms at 8:08; e2e pass at 8:44 (after freeze); a PR merged at **8:55, five minutes before demos** |

Parallel tracks are good: they gave us 95 commits in two hours. But they merge into `main` **every
hour**, not at the end. At freeze, tag `demo`; **nothing merges after it**; the demo runs the tag.

### 10. Rehearse twice, timed, on the venue setup

We skipped this at **both** events. It is a roadmap row with a time and a person:
first run at freeze + 5 min, second at freeze + 15 min. Every input (mic, camera, sensor) gets one
real human test on the venue setup.

### 11. Verify against primary data and the real running system

HTTP 200 isn't success, and a field name isn't content (won: a stale map, an Ireland layer, an error
page saved as a fixture). Walk production with a scripted browser after every deploy, including the
voice path with a fed-in recorded voice (`scripts/verify-e2e.py`, which caught 4 real bugs at
Converge before the judges could).

### 12. Vote honestly in peer voting

At Converge we voted for the weakest entry, hoping it would split the field for us. A tactical vote
changes nobody else's ballot; it only throws your own away. Vote for the strongest rival.

---

## What carried over and worked both times

- **Prep the night before.** Verification isn't code: keys proven with a real call, CLIs current,
  deploy target authenticated, data sources probed. We lost no time to setup at either event.
- **Lift working code, don't rewrite it.** The voice interviewer moved from one repo to the next
  in **two minutes** (`6:42` → `6:44`) because it was copied, not rebuilt.
- **Commit every unit of work.** 76 and 112 commits. The timestamped history answers "was this
  pre-built?" and lets anyone see where we are.
- **Periphery to agents, spine to a person.** `playbooks/parallel-build-playbook.md`.
- **Tag before risky changes**, with a written abort rule.
- **Precompute slow AI.** Nothing over about 3 seconds happens live on stage.
- **Name the limits.** Never present a mock as live.

## What to ask a judge afterwards

We never learned why Converge didn't place. Next time, win or lose, ask one judge two questions
and write the answers into the lessons doc: *"What made the winner stand out?"* and *"What would
have made ours land?"*
