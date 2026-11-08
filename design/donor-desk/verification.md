# Verification

- `npm run typecheck` and `npm run build:demo` passed.
- ESLint passed for the changed TypeScript components; formatting and `git diff --check` passed.
- Tested the React demo with the existing snapshot provider at 1206 × 763 and 390 × 844.
- Q4 percentage sits below its arc. All four overview tiles fit the desktop sidebar; long task collections scroll within their panel.
- Mobile stacks the conversation before the overview, keeps workspace controls reachable, and has no horizontal overflow (390px document width at a 390px viewport).
- Task folders, task details and completion, donor question responses, and the donor import dialog work. No donor file was uploaded during verification.
- Composer remains white while focused. Enter sends without a bloom; explicit Send activation runs the yellow/green bloom. Reduced-motion styles disable the animation.
- Browser console had no errors during these checks.

`reference.png` is the approved standalone mockup. `implemented.png` and `mobile.png` show the React implementation with sample data. Snapshot chat retains its existing supported-question behavior; this PR does not replace the agent service or change data providers.
