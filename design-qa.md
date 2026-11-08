# Conversation restoration QA

final result: passed

## Target, source capture and density

User-selected source: `docs/design/chat-restoration/reference.png` (1924 × 1160). This is a cropped conversation screenshot, not a whole dashboard. Its type and component sizes correspond to the original mock's 28px heading and 14px messages at approximately 2× density. Normalize its central 1800 × 1160 region (x=46..1846) to 900 × 580; `reference-normalized.png` preserves that crop.

Implementation: `docs/design/chat-restoration/conversation.png` (900 × 660 pixels at a verified 900 × 660 CSS viewport). The first 580px are compared against the selected source; the remaining 80px show the composer, which lies below the source crop. Browser measurements confirmed the conversation itself was x=0, width=900 before capture. A capture taken while a different tab owned the viewport override was discarded and replaced, not used for acceptance.

Full composition: `comparison.png`. Focused message and type comparison: `comparison-detail.png`. Both source and implementation were viewed together in each combined image. The current live website was opened and captured as `live-before.png` before implementation. Actual dashboard verification is `dashboard-after.png`; phone capture is `dashboard-mobile.png` at 390 × 844 CSS pixels.

## Findings and comparison history

- [P1, resolved] The live agent used a separate gray boxed reply renderer, narrower text and tighter thread spacing. Live and sample threads now share open AgentReply/UserMessage components and the same thread layout. Approval and tool cards remain distinct functional controls within replies.
- [P2, resolved] The selected suggestion row was missing. Restored gray pills with keyboard focus and disabled states; selection fills/focuses the input and does not submit.
- [P2, resolved] Agent labels were 11px and live prose retained generic Markdown paragraph metrics. Labels now use 12px/700 and prose inherits 14px/21px with compact paragraph spacing. Greeting metrics are explicit rather than drifting with generic heading utilities.
- Follow-up captures after these fixes show the same hierarchy, alignment, message wrapping and open white canvas. No remaining actionable P0/P1/P2 findings.
- [P3] About 4px of consistent vertical offset remains between the cropped reference and the full component capture. Do not compensate by shifting the real page: the reference has no original viewport/crop metadata. The 2× reference also retains sharper rasterized glyph edges than the browser's 1× capture.

## Required fidelity surfaces

- **Fonts/typography:** Avenir Next/Avenir on this Mac, existing bundled Inter on other systems. 28px/400 greeting, bold staff name, 14px/21px replies, 12px/700 labels and 12.5px suggestion text match the measured source. Greeting falls to 26px at the existing phone breakpoint. No font service or new licensing dependency.
- **Spacing/layout:** 900px maximum conversation width, 24px inner desktop padding, 16px turn gaps, 12px vertical message padding, 24px user-message radius and 88% message maximum. Existing overview and composer placement remain. The greeting has the original larger breathing room; the briefing clears when conversation begins.
- **Colors/tokens:** white canvas, #f8f0cc user bubbles and #eef0f2 suggestions. Foreground/focus colors use the app tokens. Existing dark-theme variables and a dark user-bubble override are retained; dark mode was checked in code, not visually captured.
- **Image quality/assets:** the reference is editable UI text and standard pills, with no illustration or custom raster asset to generate. Existing Lucide icons remain. No image substitutes or custom icon drawings were added.
- **Copy/content:** the isolated preview reproduces the supplied sample conversation and Denise greeting. Production continues to use actual agent replies, time-aware greeting and available staff name, and general prompts; it does not invent sample people or successful actions. The preview-only label and composer below the source crop are intentional differences.

## Functional verification

Actual local dashboard: selecting “Who's late on a usual gift?” fills the input while the briefing stays unchanged; Send returns a real sample-data Ask result, clears the opening briefing and displays the open agent response. Computed message type is Avenir 14px/21px; user bubble is #f8f0cc with 24px radius; agent background is transparent. No console errors in this check.

Phone dashboard at 390 × 844: document scrollWidth=390, suggestion row wraps, input bottom=810 (inside viewport), and Send remains visible. The isolated preview also wraps long messages without horizontal overflow. A fresh final preview tab had no console errors. The development entry now disposes its React root on HMR to avoid duplicate-root warnings while editing.

Validation: TypeScript, changed-file ESLint and demo build passed. 44 existing agent-chat, home-data and briefing tests passed in a Node harness with browser storage shims, including streaming/approval/undo state. Existing ESLint config and bundle/sourcemap warnings remain. No live production message was submitted and no backend or API contract changed.

## Implementation checklist

- [x] Inspect current live dashboard and resolve source styles.
- [x] Restore shared chat layout and explicit typography.
- [x] Restore draft-only suggestion chips and clear the initial briefing once chatting.
- [x] Preserve existing agent operation handlers.
- [x] Verify actual sample Ask flow, responsive composer and console.
- [x] Compare source and implementation together at normalized scale and detail.

---

## Earlier design QA

## Direct dashboard handoff — follow-up

final result: passed

The organization form no longer shows “Step 2 of 3.” Continue opens the dashboard immediately, without the context receipt/welcome page or an initial tour prompt. Website processing retains save/task/slow-read/error handling after the form unmounts. Full local journey verified with no console errors; 88 targeted tests, typecheck, changed-file lint and demo build passed. Evidence: `docs/design/upload-flow/handoff-preview.png`. See the updated organization QA for details.

# Latest design QA — organization setup

final result: passed

Selected source: `docs/design/upload-flow/approved-organization.png`. Browser implementation: `docs/design/upload-flow/organization-target-size.png`, both 1536 × 1024 pixels. Full and focused combined comparisons: `organization-comparison.png` and `organization-detail-comparison.png` in the same directory. Both were inspected together with the reference.

The compact card, restrained top haze, typography, spacing, colors, actual raster background and UI copy were checked. An initial faint haze/heavy wordmark mismatch was fixed and recaptured. Prefilled values and the short snapshot-mode hint are intentional functional differences. No actionable P0/P1/P2 findings remain.

Desktop and 390 × 844 phone layout, URL validation, optional social-field expansion/error focus, Continue, Finish later and the full landing-to-profile journey were exercised. Final console was clear; types, lint and build passed. See [full organization QA](docs/design/upload-flow/organization-qa.md) and [four-step preview](docs/design/upload-flow/preview.png).

---

## Earlier dashboard QA

# Current Kindred local motion demo QA

final result: passed

The local autonomous-color demo passed visual and responsive review against the selected landing layout. See [current demo QA](docs/design/landing/motion-demo/design-qa.md) for captures, comparisons, motion/pause observations, checks and limitations.

The [previous static landing QA](docs/design/landing/design-qa.md) and [older standalone outreach-inbox QA](docs/design/outreach-inbox-qa.md) remain preserved separately.

Latest refinement: [smaller upload button check](docs/design/landing/smaller-upload-button-qa.md) passed; desktop and phone evidence included.
