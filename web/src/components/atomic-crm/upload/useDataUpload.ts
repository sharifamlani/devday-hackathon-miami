import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { donorDeskMethods } from "../providers/local";
import {
  addFiles,
  ingestSummary,
  plainError,
  type SkippedFile,
} from "../onboarding/firstRun";
import type { FilesSummary } from "../onboarding/onboardingState";

export type DataUploadPhase =
  "empty" | "chosen" | "processing" | "results" | "error";

/**
 * The Add data dialog's logic: pick files, send them through the same
 * POST /ingest pipeline onboarding uses (donorDeskMethods.uploadFiles, target "auto"),
 * then refresh every panel. No duplicate checking of its own: the service's ingest does that.
 */
export const useDataUpload = () => {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<FilesSummary | null>(null);
  const [error, setError] = useState<string | undefined>();
  // Guards re-entrancy synchronously (a double click lands before state commits).
  const inFlight = useRef(false);

  const choose = useCallback(
    (incoming: File[]) => {
      const next = addFiles(files, incoming);
      setFiles(next.files);
      setSkipped(next.skipped);
      setError(undefined);
    },
    [files],
  );

  const remove = useCallback((name: string) => {
    setFiles((current) => current.filter((f) => f.name !== name));
  }, []);

  const upload = useCallback(async () => {
    if (inFlight.current || files.length === 0) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await donorDeskMethods.uploadFiles(files, "auto");
      setSummary(ingestSummary(result, files.length));
      setFiles([]);
      setSkipped([]);
      // No key: Home tiles, CRM, calendar and duplicates all change.
      await queryClient.invalidateQueries();
    } catch (cause) {
      setError(plainError(cause, "We couldn't import these files. Try again."));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [files, queryClient]);

  /** Back from the error to the chosen files (they are kept for a retry). */
  const dismissError = useCallback(() => setError(undefined), []);

  const phase: DataUploadPhase = pending
    ? "processing"
    : error
      ? "error"
      : summary
        ? "results"
        : files.length > 0
          ? "chosen"
          : "empty";

  return {
    phase,
    files,
    skipped,
    summary,
    error,
    pending,
    choose,
    remove,
    upload,
    dismissError,
  };
};
