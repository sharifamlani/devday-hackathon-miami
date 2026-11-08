# Organization setup — approved card implementation

final result: passed

## Target and evidence

The selected visual target is `approved-organization.png`, the user's approved still with the balanced yellow/green haze. Implementation: `organization-target-size.png`. Both are 1536 × 1024 pixels; the browser viewport was 1536 × 1024 CSS pixels and screenshot output was CSS-sized. No density correction was necessary.

The full view `organization-comparison.png` presents source and implementation together at half-size. The focused `organization-detail-comparison.png` presents equal card crops at 1:1. Both combined inputs were opened and inspected. The rendered card measured 472 × 596 CSS pixels, matching the approved still's approximately 472 × 596 card. At smaller desktop sizes the card/type scale responds proportionally; the 390 × 844 phone capture is `organization-mobile.png`.

## Findings and iteration

- [P2, resolved] First implementation's haze was too faint and the wordmark too heavy. Generated and placed a dedicated raster haze matching the approved still, reduced wordmark weight, and recaptured/recompared both full view and card detail. The final haze remains confined to the rounded card top and fades into white.
- The initial fixed card dimensions were replaced with responsive clamps, restoring the approved proportions at the target viewport while preserving a compact phone card.
- No remaining actionable P0/P1/P2 findings. Optical differences between the generated typography and the product's Avenir stack are minor; preserving the landing font family is intentional.

## Fidelity surfaces

- **Typography:** existing Avenir Next/Avenir/Inter Variable stack; responsive heading, wordmark, inputs and button sizes. All source copy is preserved. Labels and controls remain legible on phone.
- **Spacing/layout:** compact centered card, thin border, soft shadow, white surrounding page. The organization-specific frame replaces the old large header/progress bars. Optional socials are collapsed and expand within a scrollable body while actions remain visible.
- **Colors:** actual raster `web/public/upload-art/organization-haze.png`, based on the selected still, provides pale yellow/olive haze at the inside top. Outer page stays white. Error/focus colors remain visible in either app theme.
- **Image quality:** generated 2172 × 724 raster haze displays proportionally at 3:1; no stretched illustration or CSS-drawn replacement. No new icon or logo substitutes.
- **Copy/content:** saved profile links prefill rather than showing the still's empty placeholder. Snapshot mode adds the short “Preview uses sample context.” hint; this is an intentional truthful mode distinction. “Finish later” matches the target. The user subsequently requested removal of the step count, so the latest organization capture omits it. The external preview label/controls are development-only.

## Interaction checks

Verified in the browser: landing CTA enters animation; animation automatically reaches 100 and results; profile CTA opens this card; required website validation; social expansion/collapse; a hidden invalid social URL reopens its field and receives focus; a valid handle continues directly to the dashboard; Finish later closes setup; Start over returns the preview to the landing.

At 390 × 844 there was no horizontal overflow, and Continue remained visible with social fields expanded. The final preview console was clear. Typecheck, changed-file ESLint and demo build passed. Existing bundle/sourcemap and ESLint config warnings are unchanged.

## Full journey preview

`preview.png` combines the four final 1280 × 800 CSS-sized captures, normalized into equal panels without stretching. `/design/upload-flow/index.html` now starts at the actual landing component and supplies an explicitly labeled preview action; it never reads or transmits donor files. Default run: landing → 12-second animation → results → real organization form. Live production uploads keep the existing API behavior and the hosted snapshot remains read-only.

## Follow-up: direct dashboard handoff

Removed the context receipt/welcome screen from the flow and the organization step-count footer per the user's annotations. Continue closes setup immediately; the existing context/save call and task generation now run independently of the unmounted form. Slow research still uses the existing refresh watcher, and failures remain visible through its status message. The initial tour prompt is skipped so it does not intercept this handoff. Previously saved sessions on the retired context screen also go directly to the dashboard.

Verified the full sample journey again in the browser: no step-count text, no final setup dialog or tour prompt after Continue, dashboard visible, and no console errors. Updated `04-organization.png`, added `05-dashboard.png` and `handoff-preview.png`. Typecheck, changed-file lint and demo build passed; 88 targeted tests include five new background-processing cases covering completion after setup closes, read-only endpoint behavior, task failure, slow-read tracking, and research failure. No live organization write was made during browser QA.
