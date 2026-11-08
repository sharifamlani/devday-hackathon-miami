# Kindred landing design

The primary React app opens on the Kindred landing page at its bare URL, regardless of saved onboarding state or whether donor records already exist. **Get started** opens the CRM home route with the forced first-run flag, so onboarding opens from the landing. The existing workspace remains directly available at `#/`, and existing hash deep links still work. `#/welcome` returns to the landing.

**Headline:** Less time on tasks. More time for people.

**Supporting line:** Your mission deserves more of your time.

The layout centers all information in one screen at the checked desktop and phone sizes. It uses white, charcoal, yellow and muted olive, with one clear primary action. Both app entry points use the shared `DonorDesk` component, so the normal and Vercel demo builds receive the same design.

The landing has no upload or sample-data shortcut. **Get started** moves into the workspace hash route and starts onboarding; all file imports begin there, then continue through organization research. The onboarding file step supports multi-file upload and the bundled **Import demo files** action. The organization step starts with The Miami Foundation's name and website, both editable; the name travels with the context request and is saved in the organization profile.

The context screen distinguishes live and saved source results. When a live read fails or times out, it says saved same-website research is being used; for partial reads, successful live sources take precedence and saved facts are used only for failed or empty sources. The source status is saved with the organization profile so the dashboard keeps cached facts labeled. Snapshot mode labels saved sample context and remains read-only.

The Impact & Story panel offers **Refresh research** in the live build so the presenter can retry after onboarding; snapshot mode labels its saved sample context and has no live refresh action.

The linked screenshots and earlier QA notes record the previous landing variant with upload/sample shortcuts. The onboarding-only landing change above has not yet received a new visual QA pass.

## Review

- [Desktop implementation](desktop.png)
- [Phone implementation](mobile.png)
- [Approved upload refinement](approved-upload-reference.png)
- [Upload comparison](upload-comparison.png)
- [Approved page still](approved-reference.png)
- [Paired comparison](comparison.png)
- [Design QA and verification](design-qa.md)

The ambient asset in `web/public/landing/ambient.png` was generated using the built-in image tool with the approved still attached. Prompt: create a text-free 1440 × 810 backdrop, true white upper/center, golden-yellow lower-left and muted olive lower-right light; remove all text, wordmark, controls, shapes and the center halo. The refined landing upload button has no backlight or shadow.
