import { useId } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTRIBUTE } from "../onboarding/firstRun";
import { UploadProcessing } from "./UploadProcessing";
import { useDataUpload } from "./useDataUpload";
import "./add-data.css";

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

/** Add more data to the CRM after setup: drop files, upload them, see what was recognized. */
export const AddDataDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const up = useDataUpload();
  const id = useId();
  const busy = up.phase === "processing";
  const {
    getRootProps,
    getInputProps,
    open: pick,
    isDragActive,
  } = useDropzone({
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: busy,
    onDrop: up.choose,
  });
  // Closing mid-upload would hide the result; the request keeps running, so ignore the close.
  const close = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
  };

  const showProcessing =
    up.phase === "processing" || up.phase === "results" || up.phase === "error";
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!busy}
        aria-describedby={`${id}-desc`}
      >
        {showProcessing ? (
          <>
            <DialogTitle className="sr-only">Add data</DialogTitle>
            <DialogDescription id={`${id}-desc`} className="sr-only">
              Importing your files.
            </DialogDescription>
            <UploadProcessing
              embedded
              pending={up.pending}
              summary={up.summary}
              error={up.error}
              readyHeading="Your data is added."
              continueLabel="Done"
              continueIcon={false}
              onContinue={() => onOpenChange(false)}
              onRetry={() => void up.upload()}
              onBack={up.dismissError}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add data</DialogTitle>
              <DialogDescription id={`${id}-desc`}>
                Spreadsheets, notes and sign-in sheets become people and gifts.
              </DialogDescription>
            </DialogHeader>
            <div
              {...getRootProps({
                className: "add-data-drop",
                "data-active": isDragActive || undefined,
              })}
            >
              <input
                {...getInputProps({ accept: ACCEPT_ATTRIBUTE })}
                aria-label="Choose files"
              />
              <Upload aria-hidden="true" size={22} strokeWidth={1.7} />
              <p className="m-0 font-semibold">
                {up.files.length
                  ? "Drop more files here"
                  : "Drop your files here"}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={pick}>
                {up.files.length ? "Choose more files" : "Choose files"}
              </Button>
              <p className="m-0 text-xs text-muted-foreground">
                .xlsx, .docx, .md, .csv or .txt, up to 10 MB each
              </p>
            </div>
            {up.skipped.length > 0 && (
              <ul
                className="m-0 grid list-none gap-1 p-0 text-xs text-muted-foreground"
                aria-label="Skipped files"
              >
                {up.skipped.map((s) => (
                  <li key={s.name}>
                    <strong>{s.name}</strong> was skipped. {s.reason}
                  </li>
                ))}
              </ul>
            )}
            {up.files.length > 0 && (
              <>
                <ul className="add-data-files" aria-label="Chosen files">
                  {up.files.map((f) => (
                    <li key={f.name}>
                      <span>{f.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {size(f.size)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => up.remove(f.name)}
                        className="grid size-6 place-items-center rounded-full hover:bg-background"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Button type="button" onClick={() => void up.upload()}>
                  Upload{" "}
                  {up.files.length === 1
                    ? "1 file"
                    : `${up.files.length} files`}
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
