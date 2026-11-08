# PREVIEW ONLY: a calmer donor detail (CRM row expand)

Sharif (Slack, 09:38): the donor screen inside the CRM "is a bit busy and could use some improvements."
This is a proposal to pick from. No code ships from this PR.

## What makes it busy today (main, #209)

```
| VB  Veloria Bay Foundation (!) [Needs a call] [Late]   $350,000 · Apr 15, 2025   $850,000   93 |
|   About Veloria Bay Foundation                                                               |
|   No notes yet.                                                                              |
|   [Needs a call] [Late] (!) Merged automatically. Review merges     <- badges shown twice    |
|   +-----------------------+  +-----------------------------+                                |
|   | Email                 |  | Phone                       |   <- five boxed tiles,        |
|   | g•••@example.org      |  | Not recorded                |      equal weight, no order   |
|   +-----------------------+  +-----------------------------+                                |
|   | Lifetime  $850,000    |  | Last gift $350,000 · Apr 15 |                                |
|   +-----------------------+  +-----------------------------+                                |
|   | Gifts 3               |                                                                 |
|   +-----------------------+                                                                 |
|   Why they are ranked here: Gave every April 2022, 2024, 2025, usually via check. Last gift  |
|   $350,000 on Apr 15, 2025 (572 days ago). Nothing yet in 2026. 53 days left in the year.    |
|   [Add task] [Add to a campaign]                                    <- action at the bottom  |
```
Problems: the status badges repeat (row + panel); five same-size boxes give every fact equal weight;
the "why" paragraph is long; the one thing to do next sits last.

## Option A (recommended): labeled lines, next step first

```
| VB  Veloria Bay Foundation  (!) · Needs a call · Late        $850,000 lifetime    93   ▴ |
|  ----------------------------------------------------------------------------------------  |
|  NEXT STEP   Call about the usual April gift (572 days since the last one)   [Call] [Add task] |
|  ABOUT       No notes yet.                                   written by the agent           |
|  GIVING      3 gifts · last $350,000 on Apr 15, 2025 · usually every ~2 years               |
|  CONTACT     g•••@example.org · phone not recorded                                          |
|  ----------------------------------------------------------------------------------------  |
|  (!) Merged automatically · Review merges                              Add to a campaign    |
```
- Badges appear once, in the row. The panel has no boxes: four label/value lines, quiet text.
- The "why" paragraph collapses into the NEXT STEP line (the reason) and the GIVING line (the pattern).
- The primary action sits on the first line; secondary actions are small text links at the end.
- Phone (390px): the labels stack above their values; the NEXT STEP buttons go full width.

## Option B: two columns

```
| VB  Veloria Bay Foundation  (!) · Needs a call · Late        $850,000 lifetime    93   ▴ |
|  +-------------------------------------------+  +----------------------------------------+ |
|  | Call about the usual April gift           |  | Giving                                 | |
|  | 572 days since the last one               |  |   3 gifts · usually every ~2 years     | |
|  | [Call]  [Add task]  [Add to a campaign]   |  |   Last  $350,000 · Apr 15, 2025        | |
|  |                                           |  | Contact                                | |
|  | About · written by the agent              |  |   g•••@example.org                     | |
|  |   No notes yet.                           |  |   phone not recorded                   | |
|  +-------------------------------------------+  |  (!) Merged automatically · Review     | |
|                                                 +----------------------------------------+ |
```
- Left = what to do and what we know; right = the facts. More scannable on a wide panel,
  denser on a phone (stacks to one column).

## State summary

| Piece | Today | Option A | Option B |
|---|---|---|---|
| Status badges | Row + panel (twice) | Row only | Row only |
| Facts | 5 boxed tiles | 2 labeled lines | Right column list |
| Why ranked | Long paragraph | Folded into NEXT STEP + GIVING | Under the action |
| Primary action | Last line | First line | Top of left column |
| Merge notice | Badge row | Quiet footer link | Bottom of right column |
| About (agent summary) | Heading + text | One labeled line | Left column |

Recommendation: **A** — fewest boxes, reads top to bottom, one obvious next step.
