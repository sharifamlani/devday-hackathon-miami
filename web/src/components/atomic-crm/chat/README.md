# Chat panel (`chat/`)

The right-side assistant shown on every screen. Built on
[assistant-ui](https://github.com/assistant-ui/assistant-ui) (`@assistant-ui/react` 0.15, MIT).
It needs the PR #53 data layer (`providers/local/crmHooks.ts`).

## Drop it in

```tsx
import { ChatPanel } from "@/components/atomic-crm/chat/ChatPanel";

<ChatPanel
  context={{ screen: "giver" }}        // "giver" | "neighbor" | "community" | "calendar" | "home", + person_id?, event_id?
  selection={selectedPersonIds}        // number[]: rows ticked in the People table
  openBatchId={batchIdFromCalendar}    // calendar "Review" → opens that batch's approval card
  onBatchResolved={(id) => setBatchIdFromCalendar(null)}
/>
```

Render it once, inside `<CRM>` (it uses the data provider and react-query), as a flex/grid
child with no fixed width: it is 380 px open and a slim rail when collapsed. Optional props:
`defaultOpen` (default `true`; the viewer's last choice wins) and `className`.

## What it does

| Piece | Where | Notes |
|---|---|---|
| Greeting + quick actions | `greeting.ts` | Day count comes from the API (`give_miami_day_days_away`); Community chips never ask for money |
| Agent steps | `ChatThread.tsx` `StepUI` | Each `/chat` step is an assistant-ui tool-call part, shown with its label and summary |
| Pending batch card | `BatchCard.tsx`, `batchRules.ts` | Flagged items can't be ticked; ★/big/org items start unticked ("needs individual approval"); a named approver is required; "Send N approved" sends an explicit decision per item |
| Receipt + outbox | `BatchCard.tsx` `ReceiptCard`, outbox view | "Test mode: not actually sent" when the result is simulated. The outbox lists approvals made in this browser (no `GET /outbox` hook yet) |
| History | `threadStore.ts` | One thread per chat in `localStorage` (`donor-desk.chat.v1`) through assistant-ui's `ThreadHistoryAdapter`; reopens the last chat after a reload |
| `/chat` adapter | `chatAdapter.ts` | Sends history, text and `{...context, selection}`. Errors (503, timeouts) render inline instead of throwing |

Snapshot mode shows the canned run labeled **"Demo run (cached sample)"**.

## Tests

```bash
npx vitest run --config vitest.config.ts --project app src/components/atomic-crm/chat
```
