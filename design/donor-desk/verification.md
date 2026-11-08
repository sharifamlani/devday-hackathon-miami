# Verification

- TypeScript, demo production build, changed-file ESLint, formatting, and diff checks passed.
- Browser checked with the existing snapshot provider at 1206 × 763 and 390 × 844; mobile document width was 390px with no horizontal overflow.
- Overview toggle hides/restores the complete column and stays reachable. Bottom controls remain aligned to the bottom of the mobile rail.
- Projects filters existing campaigns, saved questions, and donor-list shortcuts. Their navigation uses existing app routes.
- Calendar week navigation loads the selected week’s service feed. Events with no times remain all-day. Nearby timed events share a selectable block; the details dialog shows both original titles and times and opens the correct day plan.
- Q4 uses actual target values and preserves the sample-goal label. The percentage and arch scale as one SVG.
- No browser console errors during these checks. Existing Vite configuration, sourcemap, and bundle-size warnings remain.

The standalone reference is illustrative. The React implementation preserves the existing data providers, task completion, chat, import, and planning flows. This PR does not change backend services or publish a deployment manually.
