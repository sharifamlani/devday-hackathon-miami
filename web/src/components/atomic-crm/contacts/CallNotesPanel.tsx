import { useContext, useState } from "react";
import { AudioLines, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AskSessionContext } from "../ask/askSessionContext";
import { DATA_MODE, PUBLIC_READ_ONLY } from "../providers/local/config";
import { callNotesForDonor } from "../providers/local/crmDonors";
import { useCallNotes, type CallNote } from "../voice/callNotes";
import { PhoneCallDialog } from "../voice/PhoneCallDialog";
import { ProfileSection } from "./donorCrmUi";

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const duration = (sec: number) =>
  sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} sec`;

/**
 * Call notes for one donor: the ones the service saved (GET /donors/{id}
 * call_notes) and the ones saved in this browser from the live transcript
 * pane with this donor as a destination. Read-only here.
 */
export const CallNotesPanel = ({
  donorId,
  serverNotes = [],
  limit,
}: {
  donorId: number;
  serverNotes?: CallNote[];
  limit?: number;
}) => {
  const browserNotes = useCallNotes();
  const session = useContext(AskSessionContext);
  const notes = callNotesForDonor(donorId, serverNotes, browserNotes);
  const shown = limit ? notes.slice(0, limit) : notes;
  // Placing a phone call needs the laptop service; the Vercel snapshot can't
  const canPhone = DATA_MODE === "local" && !PUBLIC_READ_ONLY; // public mode refuses /phone/*
  const [phoneOpen, setPhoneOpen] = useState(false);

  return (
    <ProfileSection
      title="Call notes"
      caption="From the live transcript pane"
      actions={
        session || canPhone ? (
          <div className="flex flex-wrap gap-2">
            {canPhone && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setPhoneOpen(true)}
              >
                <Phone aria-hidden />
                Call from my phone
              </Button>
            )}
            {session && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => session.openPane("voice")}
              >
                <AudioLines aria-hidden />
                Start a call
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {canPhone && (
        <PhoneCallDialog
          donorId={donorId}
          open={phoneOpen}
          onOpenChange={setPhoneOpen}
        />
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No call notes yet. Notes saved to this donor from a call show up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((note) => (
            <li key={note.id} className="rounded-xl bg-muted/60 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="font-medium">
                  {note.title}
                  {note.id.startsWith("phone-") && (
                    <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                      <Phone aria-hidden className="mr-1 inline size-3" />
                      Phone call · recorded
                    </span>
                  )}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {when(note.createdAt)}
                  {note.durationSec > 0 && ` · ${duration(note.durationSec)}`}
                </span>
              </div>
              {note.summary.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {note.summary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {note.nextSteps.length > 0 && (
                <p className="mt-1.5 text-xs">
                  <span className="font-medium">Next steps:</span>{" "}
                  {note.nextSteps.join(" · ")}
                </p>
              )}
              {note.notes.trim() && (
                <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">
                  {note.notes}
                </p>
              )}
              {note.transcript.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    Transcript ({note.transcript.length} lines)
                  </summary>
                  <ol className="mt-1.5 space-y-1 text-xs">
                    {note.transcript.map((line, i) => (
                      <li key={i}>
                        <span className="font-medium">{line.name}:</span>{" "}
                        {line.text}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {limit && notes.length > limit && (
        <p className="text-xs text-muted-foreground">
          {notes.length - limit} more on the full record.
        </p>
      )}
    </ProfileSection>
  );
};
