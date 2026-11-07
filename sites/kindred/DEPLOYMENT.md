# Publish a reviewed revision to the same Site

## Stable destination

- URL: https://kindred-donor-outreach-demo.c-gonzalez3.chatgpt.site
- Existing project ID: `appgprj_6aef8e7b3e948191989ddbadf3924bb5`
- Application source: `sites/kindred/`
- Static output: `dist/`
- Current intended audience: anyone with the link.

Do not register another Site, retarget the Atomic CRM app, or change sharing as part of a source release.

## Team workflow

1. Work on a personal feature branch. Run `npm --prefix sites/kindred run ci` locally and review the changed browser behavior.
2. Open a PR. The authorized integrator reviews it and merges it through GitHub's normal merge controls, respecting required checks and reviews.
3. Fetch the merged revision. Record its full commit SHA, not a moving branch name.
4. Export the exact committed Kindred subtree to a **new directory outside the repository**:

   ```sh
   node sites/kindred/scripts/prepare-release.mjs \
     --source-commit <full-40-character-reviewed-commit-sha> \
     --output /absolute/path/outside-the-repo/kindred-release
   npm --prefix /absolute/path/outside-the-repo/kindred-release run ci
   ```

   Use an absolute path appropriate to your operating system. The exporter does not fetch, commit, push, deploy, or change access. It ignores uncommitted working edits, preserves the existing hosting manifest, refuses symlinks and dotenv files, and records file hashes plus the GitHub source SHA in `RELEASE.json`.

5. Ask the Site owner or eligible Site editor to update **the existing Kindred Site** from that reviewed release directory. A useful request is:

   > Publish the reviewed Kindred source from GitHub commit `<SHA>`, folder `sites/kindred`, to the existing Site `appgprj_6aef8e7b3e948191989ddbadf3924bb5`. Keep its URL and current access. Run the local checks and verify the published result.

6. The publisher opens the existing Site's deployment-source checkout, reconciles any newer source, and copies the verified release files into that checkout without replacing its Git metadata. Keep `RELEASE.json` outside `dist/`. The publisher then saves and publishes that exact source version through ChatGPT Sites.
7. Record the deployed Site version and GitHub SHA. Walk the production URL: inbox → import sample → review two duplicate matches → confirm three new donors; then call simulation → flag → human join → follow-up. Reset demo when finished. Check mobile layout and console errors for any UI changes.

## Important limits

This is a **manual, reviewed publication workflow**, not GitHub auto-deploy, a webhook, or a shared live database. A GitHub merge alone does not update the URL. No deploy keys or persistent permissions are created by this setup. GitHub collaborators do not automatically become ChatGPT Site editors.

Do not upload real donor data into this prototype. Real backend integration is separate work against the team's contracts and ownership plan. If someone edited the Site directly after the last release, compare and reconcile those changes into a GitHub PR before publishing; do not overwrite them blindly.
