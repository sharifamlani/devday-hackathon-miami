# Spec: intelligent ICP + prospect finder + organization outreach

Lead spec, Sat Nov 7 (evening). Sharif's direction: Christian owns the design and integrates it with the
atomic-crm UI; our side focuses on **wiring, the intelligent ICP, outreach to organizations, and context**.

## What it does (the demo beat)
"Here are the organizations that look like your best donors, and why." From the Foundation's current
organization donors, an agent builds an **ideal donor profile (ICP)**, finds **new organization prospects**
in South Florida that match it, explains each match with sources, and drafts a **first-touch** email that
leads with the Foundation's real work. A human sends every prospect email.

## Rules (inherit plan.md §3 + ROADMAP §2)
- **Organizations only.** Prospects are companies or foundations, never private individuals.
- **Every claim has a source URL that loads.** No URL, no claim.
- Prospect drafts are always `draft` (a human sends), with no dollar ask and no invented relationship.
- Deterministic numbers (giving bands, counts, scores) are computed in Python; the LLM describes and matches.
- Everything is precomputed and cached for the stage; live runs are optional and time-limited (90 s).
- Exclude anyone already in `donors`.

## Pipeline
1. **ICP stats (Python, deterministic):** from org donors + gifts + scores: giving band, cadence, tiers,
   Foundation priorities their research touches.
2. **ICP profile (agent, structured output):** traits = sector, causes funded, geography, giving style,
   ties to the Foundation's 5 priorities, each with the evidence (donor + fact + URL) behind it.
3. **Prospect finder (agent + web search):** 6–10 South Florida organizations matching the ICP; for each:
   name, type, why it matches (which ICP traits), 2+ sourced facts, a fit score (Python, from matched
   traits), and the Foundation priority it fits.
4. **First-touch draft (outreach agent):** introductory, leads with a matched Foundation fact, ends with a
   conversation ask; status `draft`.

## Contract (8b owns the schema; 90 wires the routes)
- `icp_profile(id, traits JSON, stats JSON, evidence JSON, created_at)`
- `prospects(id, name, org_type, city, fit_score, matched_traits JSON, facts JSON [{fact,url}], priority,
  status 'new'|'drafted'|'dismissed', created_at)`
- `outreach_drafts` gains a nullable `prospect_id` (donor_id XOR prospect_id).
- Routes: `GET /icp`, `POST /icp/run`, `GET /prospects`, `GET /prospects/{id}`, `POST /prospects/{id}/outreach`,
  `POST /prospects/{id}/dismiss`. All included in `snapshot.json` under `icp` and `prospects`.

## Owners
| Piece | Owner | Files |
|---|---|---|
| ICP stats + profile agent + prospect finder + cache | 42 | `service/icp_agent.py`, `data/icp_cache.json` |
| Schema, read routes, snapshot keys, pipeline stage | 8b | `service/db.py`, `service/routes_data.py`, `service/pipeline.py`, `service/export_snapshot.py` |
| Deeper org context + prospect first-touch drafts | 86 | `service/org_context.py`, `service/outreach_agent.py` |
| Route wiring (`POST /icp/run`, `/prospects/{id}/outreach`), timeouts | 90 | `service/main.py` |
| UI data layer for ICP/prospects, handed to Christian | 80 | `web/src/components/atomic-crm/providers/local/` |
| Design + UI integration | Christian | his paths |
| Independent checks | 98 | `qa/` |
