# Kindred landing design

The primary React app now opens on the approved Kindred landing page at its bare URL. The existing workspace remains at `#/`, and existing hash deep links still work. `#/welcome` returns to the landing.

**Headline:** Less time on tasks. More time for people.

**Supporting line:** Your mission deserves more of your time.

The layout centers all information in one screen at the checked desktop and phone sizes. It uses white, charcoal, yellow and muted olive, with a very faded button backlight. Both app entry points use the shared `DonorDesk` component, so the normal and Vercel demo builds receive the same design.

A thin outlined drop area surrounds the upload button. It accepts one CSV through drag-and-drop or the file chooser, highlights on drag/focus, and shows the selected filename before confirmation. Invalid file types are rejected.

The upload dialog uses the existing data-mode boundary. Snapshot builds offer a sample workspace and explain that uploads need the local service. Local builds submit a CSV through the existing `uploadFiles` method and show success/errors; no new backend or ingest behavior is introduced.

## Review

- [Desktop implementation](desktop.png)
- [Phone implementation](mobile.png)
- [Approved still](approved-reference.png)
- [Paired comparison](comparison.png)
- [Design QA and verification](design-qa.md)

The ambient asset in `web/public/landing/ambient.png` was generated using the built-in image tool with the approved still attached. Prompt: create a text-free 1440 × 810 backdrop, true white upper/center, golden-yellow lower-left and muted olive lower-right light; remove all text, wordmark, controls, shapes and the center halo. The subtle CTA backlight is a normal UI shadow.
