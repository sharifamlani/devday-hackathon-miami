# Local autonomous-color demo QA

Historical result: passed for the prior landing with upload/sample dialogs. The current onboarding-only landing has not had a visual QA pass; dialog observations below are from that earlier variant.

## Scope and evidence

Local demo at http://127.0.0.1:5174/. User requested colors that drift slowly on their own. The approved layout and upload component are the visual baseline; moving corner colors and the pause control are intentional additions. No deployment was performed.

- Reference: ../desktop.png, 1440 × 810 pixels, initial landing state.
- Implementation: desktop.png, 1440 × 810 CSS/pixels at device pixel ratio 1. Small phone: mobile.png, 375 × 667 CSS/pixels at density 1.
- Full-view comparison: comparison.png. Focused upload comparison: comparison-detail.png. Inputs use matching desktop dimensions/state; no density rescaling. The background animation is captured at one point in its loop.

## Findings and comparison history

First comparison passed without actionable P0/P1/P2 differences. The white center, typography, upload geometry, spacing and copy remain visually consistent with the selected layout. The existing generated ambient image is translated and scaled beneath the UI; no new gradient or decorative asset was substituted. Corner color positions change gently over a 24-second cycle. A quiet 44px-high control pauses/resumes the motion. No P3 follow-up was required for this local exploration.

## Checks

- Browser reports the background animation running with a 24s duration and a changing transform. Pause set animation-play-state to paused; its exact transform remained unchanged across subsequent observations. Keyboard Space resumed from the paused position.
- Desktop 1440 × 810 and phone 375 × 667 document dimensions equal viewport dimensions. At the small-phone viewport, the motion control starts below the process line with more than 40px separation.
- Upload dialog still opens, Escape closes it and returns focus to Upload donor data. Browser warning/error log was empty.
- prefers-reduced-motion CSS disables background animation, removes its will-change hint, and hides the unnecessary pause control. The browser OS preference was not changed or emulated during this check.
- Production demo build including TypeScript passed. Prettier and git diff checks passed. No backend/upload behavior changed; live donor ingestion was not rerun.

## Checklist

- [x] Preserve the approved text, layout, button and frame.
- [x] Add slow autonomous color drift with pause/resume.
- [x] Check responsive fit, keyboard behavior, upload action and browser logs.
- [x] Build and leave the local preview running for review.

## Intensity refinement

The user requested slightly stronger intensity. The local version now increases the backdrop saturation to 1.2 and contrast to 1.02, expands the drift range from roughly ±3% to ±4%, and shortens the loop from 24s to 20s. The existing center remains white. `intensity-v2.png` records the current 1206 × 743 CSS/pixel default browser view at density 1; document and viewport dimensions match with no scrolling. Browser-computed styles confirm the new filter, 20s loop and running state. The screenshot was visually inspected: typography, controls and framing remain clear. CSS formatting and diff checks passed. Earlier screenshots and motion observations above document the first version. No additional TypeScript or interaction changes were made in this CSS-only refinement.

## Push verification

Synced with current main, preserving the newer generic upload-button sizing and Vite report configuration. Production demo build including TypeScript passed again. Replaced an incorrectly scaled phone evidence image with a fresh, visually inspected 375 × 667 capture of the current running 20-second version; document dimensions match the viewport and the motion control remains below the process text. The earlier phone artifact was an evidence-capture issue, not a page-layout defect.
