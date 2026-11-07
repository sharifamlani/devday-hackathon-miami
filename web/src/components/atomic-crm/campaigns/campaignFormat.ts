import type {
  CampaignChannel,
  CampaignIntent,
} from "../providers/local/campaignTypes";

export const INTENTS: { id: CampaignIntent; label: string; hint: string }[] = [
  { id: "thank_you", label: "Thank you", hint: "Gratitude only, no ask" },
  {
    id: "re_engage",
    label: "Re-engage",
    hint: "An update, then one clear ask",
  },
  {
    id: "check_in",
    label: "Check in",
    hint: "A friendly update, no money ask",
  },
];

export const CHANNELS: { id: CampaignChannel; label: string; hint: string }[] =
  [
    { id: "email", label: "Email", hint: "Subject + a short note" },
    { id: "text", label: "Text", hint: "320 characters at most" },
  ];

export const intentLabel = (intent: CampaignIntent) =>
  INTENTS.find((i) => i.id === intent)?.label ?? intent;

export const isIntent = (value: string | null): value is CampaignIntent =>
  INTENTS.some((i) => i.id === value);

/** Date + time for sent/approved stamps, in the viewer's zone. */
export const formatStamp = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export const pillButton =
  "min-h-11 rounded-full px-5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
