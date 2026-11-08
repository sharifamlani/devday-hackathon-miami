# Donor upload flow QA

final result: passed

## Visual truth and comparison

Source: the user-provided “Folder box with loading progress.png” illustration, the existing approved Kindred landing design in `docs/design/landing/`, and the subsequent annotated revisions requesting a smaller animation, faster shuffle, shorter stacked tiles, and removal of the protruding back folder.

Full page evidence in this directory: `01-landing.png`, `02-loading.png`, `03-results.png`, `04-organization.png`. All four are browser-rendered at 1280 × 720 CSS pixels and returned at 1280 × 720 screenshot pixels. The combined `preview.png` presents the four states together without stretching. The existing organization form scrolls within its body at this height.

Earlier source/implementation comparisons and focused illustration/CTA comparisons were reviewed during iteration. Final focused containment comparison is retained locally at `web/design/upload-flow/qa/comparison-folder-containment.png` (development evidence, git-ignored); the reference and implementation were shown together at normalized scales. Full revision history is retained locally in `/tmp/kindred-upload-design-qa-history.md`. Only the final four screenshots and contact sheet are included in the PR.

## Findings and fixes

- [P2, resolved] The outermost back folder extended beyond the drawer silhouette. Removed that layer and evenly staggered the remaining five folders. The final screenshot and a separate raised-folder phase were inspected with the side edges contained.
- Reduced the illustration twice in response to user feedback; final art scale is 0.60 in a 200 × 144px stage. Shortened the shuffle to 3 seconds, with 0.6-second offsets between folders.
- Changed the receipt from adjacent cards to short stacked rows, accounts first, with aligned labels. Removed the estimated-time caption.
- Fixed the development preview's relative snapshot URL when handing off to the app; the button now visibly opens “Tell us about your organization”, step 2 of 3.

No actionable P0/P1/P2 visual findings remain against the final requested direction.

## Fidelity surfaces

- **Typography:** same Avenir Next / Avenir / Inter Variable stack as the landing. Compact 20px loading heading, 28px receipt heading and 14px black CTA; phone headings reduce to 19px/25px.
- **Layout:** centered loading group, white canvas and slim bar. Receipt rows are at most 360px wide and approximately 46px tall on desktop, stacked with an 8px gap. Earlier phone review at 390 × 844 showed no page overflow; later changes only reduced art size and removed a folder.
- **Color:** charcoal outline/bar/button, white/gray box, cream/white folders and muted olive checks. The processing page has no ambient color wash.
- **Imagery:** transparent generated raster layers preserve the hand-drawn reference direction; a foreground raster mask keeps folder bases inside the box. No custom SVG/CSS illustration substitutes.
- **Content:** actual API results drive normal uploads. Confirmed consolidations and pending duplicate suggestions are separate. Sample counts are explicitly labeled in the development harness.

## Verification

- TypeScript typecheck and changed-file ESLint passed.
- Demo production build passed; existing bundle-size/sourcemap warnings remain.
- 83 first-run helper/store tests passed using a Node harness with a minimal browser storage/event shim, including preserving the removal count across reload.
- 10 backend auto-merge tests passed, including confirmed removal count and dry-run zero count.
- Browser checked: actual landing, five-folder motion and transforms, pending progress, 100% transition, stacked results, and the organization button handoff. No errors in the final preview console.

This is visual/browser interaction verification plus import-contract tests. No fresh real-donor file upload, production deployment, or new live organization read was performed during this review. Hosted snapshot uploads retain their existing read-only behavior.
