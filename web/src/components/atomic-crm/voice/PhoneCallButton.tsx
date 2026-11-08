import { useState } from "react";
import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DATA_MODE,
  PUBLIC_READ_ONLY,
  type DataMode,
} from "../providers/local/config";
import { PhoneCallDialog } from "./PhoneCallDialog";

/**
 * The donor header's "Call" button: opens the call-from-my-phone dialog.
 * Local mode only (the laptop service places the call); the Vercel snapshot
 * renders nothing.
 */
export const PhoneCallButton = ({
  donorId,
  mode = DATA_MODE,
}: {
  donorId: number;
  mode?: DataMode;
}) => {
  const [open, setOpen] = useState(false);
  if (mode !== "local" || PUBLIC_READ_ONLY) return null; // public mode refuses /phone/*
  return (
    <>
      <Button size="sm" className="rounded-full" onClick={() => setOpen(true)}>
        <Phone aria-hidden />
        Call
      </Button>
      <PhoneCallDialog donorId={donorId} open={open} onOpenChange={setOpen} />
    </>
  );
};
