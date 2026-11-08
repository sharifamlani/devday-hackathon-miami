# Conversation typography and layout restoration

Restores the selected conversation design in the current app, including the live agent path that had diverged from the sample Ask thread.

- Existing Avenir Next/Avenir stack, with bundled Inter fallback; 28px regular greeting with a bold available staff name, 14px/21px body text and 12px bold Agent labels.
- Transparent agent replies on the white canvas, pale yellow user pills, 88% message width and shared 16px turn spacing.
- Gray suggestion pills above the composer. They fill/focus the input; sending is a separate explicit action. Production prompts use general donor questions rather than hardcoding the screenshot's sample people.
- The opening briefing remains available on an empty conversation and clears once a conversation starts.
- Streaming text, tool cards, approvals, undo, dictation and Send keep their existing handlers. The composer bloom still runs only on Send.

## Review locally

Run `npm run dev:demo` from `web/` and use the port printed by Vite:

- `/#/?onboarding=0`: actual dashboard, with sample data in the demo build.
- `/design/chat-restoration/index.html`: isolated reference conversation using the same UserMessage, AgentReply, Markdown and suggestion components as the app. The label identifies it as a design preview. Its input uses a local sample response and never calls an API.

## Evidence

- [Live before](./live-before.png)
- [Source reference](./reference.png)
- [Normalized comparison](./comparison.png)
- [Typography detail](./comparison-detail.png)
- [Restored conversation](./conversation.png)
- [Actual dashboard after Send](./dashboard-after.png)
- [Phone dashboard](./dashboard-mobile.png)

See the project-root `design-qa.md` for normalization, intentional content differences and validation. The production site was inspected read-only; no live messages or donor writes were sent.
