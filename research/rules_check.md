# Rules check — what's allowed before and during the event

Checked 2026-11-06 evening. Sources: Miami Luma page (signed in as a registrant), Luma registration
confirmation email, DeepStation email of 2026-11-06, and nine sibling community-hackathon pages.

## Bottom line

**Miami has published no rules beyond the three-item "Acceptance Criteria."** Nothing on the Luma page
(public or registrant view), the confirmation email or the organizer email covers tool restrictions,
preparation, pre-existing code, team size or submission format. The rules come from the opening
briefing or the hosts.

## Miami — the only official text

> Acceptance Criteria: 🔹 Codex 🔹 OpenAI API 🔹 OpenAI Agents SDK

- Most likely meaning: the project must be built with Codex and run on the OpenAI API and Agents SDK.
- Not stated: whether other coding tools (Claude Code, Cursor) are banned, or only that Codex must be used.

## Sibling events run under the same "DevDay Exchange" community program

Every city writes its own rules, and they conflict.

| City | Claude Code / other tools | Prep / prior work | Team |
|---|---|---|---|
| Tokyo (Oct 18) | **Banned by name** ("Claude Code etc. obviously … NG"); Codex CLI / App / ChatGPT Work only | Unpublished prototype OK; finished deliverable NG; **research beforehand encouraged** | 2–4 |
| Osaka | **Other dev agents out of scope**; Codex CLI / App only | Prep limited to unpublished new prototype; **research + env setup beforehand OK** | 2–4 |
| Paris | Not banned; "Codex or the OpenAI API" | Not stated | ≤4 / solo |
| Bengaluru | Not banned; "tools available to you" | "Set up Codex … beforehand" | — |
| Hanoi (Jun) | **Explicitly allowed** ("you may also use other coding tools") | Code written during event | ≤4 / solo |
| Hanoi (Nov 14) | Not banned; "Use Codex meaningfully" | Starter templates OK; **disclose what existed before** | 3–4 rec. |
| Mexico City | Not stated | Building may continue after Sat | solo / team |
| Taichung | Not banned | Not stated | 1–4 |

Patterns shared across most cities: research beforehand is fine wherever it is mentioned, and setting
up the dev environment is fine. Bringing a finished or pre-built deliverable is never allowed. The
strictest events (Tokyo, Osaka) ban Claude Code outright, and Miami's "Acceptance Criteria" wording leans
toward Codex as well.

## Safe operating posture for Miami (until the hosts say otherwise)

1. **Research tonight: yes.** Allowed or encouraged everywhere it is addressed.
2. **Environment setup tonight: yes.** Install the Codex CLI and Agents SDK, set keys, test one call, set
   up Vercel. That is setup, not deliverable.
3. **No product code tonight.** Problem statements are revealed at opening anyway, so there is nothing
   legitimate to pre-build. At most, a blank, generic scaffold, disclosed at submission.
4. **Write the product with Codex.** Treat Codex as the coding tool of record. Don't use Claude Code to
   write submission code unless a host confirms it's allowed. Keep the Codex session(s) in which the core
   was built (other events asked for session IDs).
5. **Ask at opening (or tonight via "Contact the Host" / WhatsApp):** Are non-Codex coding assistants
   (e.g. Claude Code) allowed, or must all code be written with Codex? Is pre-event environment
   setup / a blank scaffold OK? Team size? Submission format (repo, deployed URL, video, session ID)?
