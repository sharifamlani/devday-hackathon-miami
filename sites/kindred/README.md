# Kindred: the published ChatGPT Site

This directory is the team-editable source for:

**https://kindred-donor-outreach-demo.c-gonzalez3.chatgpt.site**

The app is a dependency-free HTML/CSS/JavaScript prototype. Edit `dist/index.html` here on your own branch, open a pull request, run the local checks, and have the approved change released to the existing Site. The `dist` folder is deliberately tracked because it is the buildless application source.

## Start working

From the repository root, with Node.js 22 or later:

```sh
git switch main
git pull --ff-only
git switch -c feat/kindred-your-change
npm --prefix sites/kindred run ci
python -m http.server 8000 --directory sites/kindred/dist
```

Open http://localhost:8000. No package installation, account keys, backend, or database is required. Stop the preview server with Ctrl+C. Use a separate clone or worktree when multiple sessions work on the repository.

Before opening a PR, rerun `npm --prefix sites/kindred run ci` and walk the changed UI at desktop and phone widths. Include test results in the PR. Keep CI local; this directory adds no GitHub Actions workflow.

## One source of truth, a separate publishing step

GitHub is where the team edits and reviews the Kindred source. **Merging does not automatically deploy.** ChatGPT Sites retains its own deployment source repository. A Site owner or eligible Site editor must publish the reviewed GitHub revision into the existing Site. See [DEPLOYMENT.md](DEPLOYMENT.md).

GitHub collaborators can work on branches without being Site editors. Access to the public URL is view/use access, not source-editing or deployment permission. No GitHub or Sites credentials belong in this repository.

## Boundaries

- `sites/kindred/`: the already-published Kindred prototype, now maintained here.
- `web/outreach-inbox/` in [PR #6](https://github.com/sharifamlani/devday-hackathon-miami/pull/6): a separate React prototype. This import does not replace or merge it.
- `web/`: the team's Atomic CRM application, unchanged.
- `service/` and `data/`: the live backend/data work, including Carlos's reserved ingest paths, unchanged.

The team should choose how to combine the prototypes before backend integration. This source import does not change the existing local SQLite architecture or any ownership assignment in `plan.md`.

## What works, and what is simulated

Fictional donor search, CSV preview, email/phone duplicate review, editable drafts, simulated replies, follow-up completion/snoozing, and a scripted flagged-call/human-join flow work in the browser. State is separate per browser tab. Real email, Twilio, microphones, live AI, a shared CRM database, and authentication are not connected. Use fictional data only. No model is called at runtime.

The existing app was checked on desktop and at a 390px phone layout. Local tests cover CSV quoting, validation, duplicate detection, output escaping, and the release export's provenance and safety checks. These are the Kindred checks, not the separate Atomic CRM or Python service suites.
