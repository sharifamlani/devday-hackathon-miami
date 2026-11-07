# Kindred React landing page QA

final result: passed

## Scope and visual truth

This report covers the new landing entry in the primary React app (`web/`), not the separate static Kindred or outreach-inbox prototypes. The existing repository-root QA report for the older standalone prototype is unchanged.

- Approved reference: `approved-reference.png`, 1672 × 941 pixels. White canvas, charcoal text/button, yellow/olive corner glows, very faded button backlight, and the user's final headline/subheadline.
- Implementation: `http://127.0.0.1:5174/`, using the existing `dev:demo` runtime.
- Desktop: `desktop.png`, 1440 × 810 CSS/pixel viewport, device pixel ratio 1.
- Phone: `mobile.png`, 390 × 844 CSS/pixel viewport, device pixel ratio 1.
- Full comparison: `comparison.png`; reference proportionally normalized to 1440 × 810 alongside the implementation, with a 40px label strip.
- Readable central crop comparison: `comparison-detail.png`; both normalized images cropped to the same 900 × 570 region.
- Upload-dialog evidence: `upload-dialog.png`, snapshot mode. A later typography adjustment affects the background page, not the dialog tested here.
- State: initial landing page, light appearance, no selection/hover. Browser viewport overrides reset after verification.

## Findings and iteration history

1. Initial comparison found supporting text and CTA too small relative to the approved still. Increased the supporting line from 19px to 22px; CTA label from 18px to 22px, its height from 56px to 60px, and horizontal padding from 34px to 44px. Helper/sample text increased from 14px to 16px.
2. Shifted the centered content group upward 10px after the scale adjustment. The final paired full-view and focused comparisons retain generous section spacing and all information within the viewport.
3. Final comparison: no actionable P0/P1/P2 findings. The actual font glyphs and separately generated ambient backdrop vary slightly from the raster reference (P3).

## Required fidelity surfaces

- **Typography:** Avenir Next/Avenir with the app's locally bundled Inter fallback. Regular first line, semibold second line, correctly ordered and spelled copy, readable secondary controls. The headline remains two lines on desktop and tested phones. Text remains selectable.
- **Spacing/layout:** one centered content group on a full white canvas, with a small wordmark, headline, supporting line, one primary action, helper, sample link and quiet process line. No app rail or dashboard is shown on the landing page. Desktop 1440 × 810 and 1280 × 720, and phones 390 × 844 and 375 × 667, all have document dimensions equal to viewport dimensions: no scrolling or clipped content at those sizes. Smaller or text-zoomed views can scroll rather than losing content.
- **Colors/tokens:** white surface, charcoal typography/CTA, muted olive secondary text, generated yellow/olive corner light. The button backlight is deliberately a faint 8% yellow shadow. Focus outlines use a visible olive tone. The existing workspace theme is not restyled.
- **Image/assets:** the backdrop was generated with the built-in image tool from the approved reference; it contains no text, UI, shapes or center halo. The upload icon comes from the app's existing Lucide library. The layout does not replace imagery with CSS-drawn blobs or gradients.
- **Copy/content:** exact user-approved headline “Less time on tasks. More time for people.” and subheadline “Your mission deserves more of your time.” Primary action remains “Upload donor data”; helper is “Start with a CSV file”; sample action is “Try sample data”.

## Interaction and accessibility checks

- Upload button opens the existing accessible dialog primitive with an explicit title and description.
- Snapshot mode explains that uploads require the local donor service, and offers the sample workspace. It does not accept a file or pretend to upload it.
- Escape closes the dialog and returns focus to the upload button.
- “Try sample data” opens the existing `#/` outreach workspace with its 12 sample donors and duplicate-review banner.
- Existing `#/contacts` navigation and refresh continue to mount the workspace rather than showing the landing page.
- Landing is re-enterable at `#/welcome` or the bare URL.
- Local-mode CSV input has an associated label and required-file validation; its submit/pending/error/success states use the existing typed `uploadFiles` client. A live ingest service was not available in this check, so a live local-file import is not claimed.
- Browser warning/error logs checked: no entries reported during the verified snapshot flow.

## Automated checks

- `NODE_ENV=CI npm run build:demo` passed, including TypeScript. Existing Vite config-loader, large-chunk and Tailwind sourcemap warnings remain non-blocking.
- Existing provider tests passed: **33 tests across 4 files** (`onboarding`, `httpClient`, `snapshotClient`, `parse`), run with the existing Vite config in Node mode.
- Rebased onto current `main` (`dda161f`) and repeated the production build and provider tests successfully.
- Changed TSX/CSS/HTML files formatted with the repository's Prettier.
- `git diff --check` passed.
- Backend, ingest routes, provider implementation and database schema are unchanged. The full CRM/backend suites were not run for this landing change.

## Implementation checklist

- [x] Implement the final still in the shared React entry used by local and Vercel builds.
- [x] Preserve existing workspace deep links.
- [x] Use the shared upload client and disclose snapshot availability.
- [x] Verify desktop/phone fit, sample navigation, dialog keyboard behavior and console.
- [x] Save the visual reference, screenshots and paired comparisons.
- [x] Build and run the relevant existing provider checks.

## Follow-up polish

P3: small glyph-shape and ambient-light differences from the generated still. Local ingest requires the existing service and remains a separate integration check before claiming live import readiness. This PR does not deploy or change Vercel access.
