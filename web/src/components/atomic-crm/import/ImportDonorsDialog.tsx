import { useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Info, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useDonors, useImportDonors } from "../providers/local/hooks";
import type {
  ImportedDonorRow,
  ImportMapping,
  IngestResult,
} from "../providers/local/types";
import {
  countPossibleDuplicates,
  IMPORT_FIELDS,
  parseCsv,
  suggestMapping,
  toRows,
  type ParsedCsv,
} from "./csv";

type Step = 1 | 2 | 3;
interface ParsedFile {
  file: File;
  csv: ParsedCsv;
}

const STEPS = [
  { n: 1, label: "Choose file" },
  { n: 2, label: "Match columns" },
  { n: 3, label: "Review" },
] as const;

const pill =
  "min-h-11 rounded-[28px] px-5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const inkPill = `${pill} bg-primary text-primary-foreground hover:bg-primary/90`;
const quietPill = `${pill} bg-quiet text-foreground hover:bg-olive`;

/** Three-step Kindred-style import: choose CSV, match columns, review and import. */
export const ImportDonorsDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] max-w-2xl gap-0 overflow-y-auto rounded-[26px] border-0 bg-card p-0 sm:max-w-2xl">
      <ImportFlow onClose={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
);

const ImportFlow = ({ onClose }: { onClose: () => void }) => {
  const [step, setStep] = useState<Step>(1);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const importDonors = useImportDonors();
  const { data: existing } = useDonors();

  const headers = useMemo(
    () => [...new Set(files.flatMap((f) => f.csv.headers))],
    [files],
  );

  const built = useMemo(() => {
    const rows: ImportedDonorRow[] = [];
    let skipped = 0;
    for (const { file, csv } of files) {
      const r = toRows(file.name, csv.records, mapping);
      rows.push(...r.rows);
      skipped += r.skipped;
    }
    return { rows, skipped };
  }, [files, mapping]);

  const gifts = built.rows.reduce((n, r) => n + r.gifts.length, 0);
  const duplicates = useMemo(
    () =>
      countPossibleDuplicates(
        built.rows,
        (existing ?? []).map((d) => d.email),
      ),
    [built.rows, existing],
  );
  const identified = [
    "full_name",
    "first_name",
    "last_name",
    "org_name",
    "email",
  ].some((k) => mapping[k]);

  const loadFiles = async (list: File[]) => {
    setParseError(null);
    if (list.length === 0) return;
    const parsed: ParsedFile[] = [];
    for (const file of list) {
      if (!/\.csv$/i.test(file.name) && !file.type.includes("csv")) {
        setParseError(`${file.name} is not a CSV file.`);
        return;
      }
      try {
        const csv = parseCsv(await file.text());
        if (csv.headers.length === 0 || csv.records.length === 0) {
          setParseError(`${file.name} has no donor rows.`);
          return;
        }
        parsed.push({ file, csv });
      } catch {
        setParseError(`Could not read ${file.name}.`);
        return;
      }
    }
    const all = [...new Set(parsed.flatMap((f) => f.csv.headers))];
    setFiles(parsed);
    setMapping(suggestMapping(all));
    setStep(2);
  };

  const submit = () =>
    importDonors.mutate(
      { files: files.map((f) => f.file), mapping, rows: built.rows },
      { onSuccess: (r) => setResult(r) },
    );

  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-5 text-left sm:px-7 sm:py-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Import donors
        </p>
        <DialogTitle className="text-[17px] font-semibold sm:text-[19px]">
          Bring in your donor list
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Upload a CSV, tell us which column is which, and review before
          anything is saved.
        </DialogDescription>
        <ol aria-label="Import steps" className="mt-3 flex flex-wrap gap-2">
          {STEPS.map(({ n, label }) => (
            <li
              key={n}
              aria-current={step === n ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold",
                step === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-quiet text-quiet-foreground",
              )}
            >
              <span className="tabular-nums">{n}</span> {label}
            </li>
          ))}
        </ol>
      </DialogHeader>

      <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">
        {result ? (
          <ResultView result={result} onClose={onClose} />
        ) : step === 1 ? (
          <ChooseFile onFiles={loadFiles} error={parseError} />
        ) : step === 2 ? (
          <MatchColumns
            headers={headers}
            mapping={mapping}
            onChange={(field, header) =>
              setMapping((m) => ({ ...m, [field]: header }))
            }
            preview={
              files[0]
                ? toRows(
                    files[0].file.name,
                    files[0].csv.records.slice(0, 3),
                    mapping,
                  ).rows
                : []
            }
            canContinue={identified}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Donors" value={built.rows.length} />
              <Stat label="Gifts" value={gifts} />
              <Stat label="Skipped rows" value={built.skipped} />
              <Stat label="Possible duplicates" value={duplicates} />
            </div>
            <div className="flex items-start gap-3 rounded-[13px] bg-quiet px-4 py-3 text-xs leading-relaxed text-quiet-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Nothing is merged until you approve each duplicate. Rows with no
                name and no email are skipped.
              </p>
            </div>
            {importDonors.error && (
              <p
                role="alert"
                className="rounded-[13px] bg-alert px-4 py-3 text-xs text-alert-foreground"
              >
                Import failed: {(importDonors.error as Error).message}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className={quietPill}
                onClick={() => setStep(2)}
                disabled={importDonors.isPending}
              >
                Back
              </Button>
              <Button
                type="button"
                className={inkPill}
                onClick={submit}
                disabled={importDonors.isPending || built.rows.length === 0}
              >
                {importDonors.isPending
                  ? "Importing…"
                  : `Import ${built.rows.length} ${built.rows.length === 1 ? "donor" : "donors"}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

const ChooseFile = ({
  onFiles,
  error,
}: {
  onFiles: (files: File[]) => void;
  error: string | null;
}) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-[22px] border-2 border-dashed border-border bg-surface px-5 py-9 text-center",
          dragging && "border-primary bg-brand-soft",
        )}
      >
        <UploadCloud className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">Drop a CSV here</p>
        <p className="text-xs text-muted-foreground">
          One row per donor or per gift. You can pick more than one file.
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          className={inkPill}
          onClick={() => inputRef.current?.click()}
        >
          <FileSpreadsheet />
          Choose file
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-[13px] bg-alert px-4 py-3 text-xs text-alert-foreground"
        >
          {error}
        </p>
      )}
    </>
  );
};

const selectClass =
  "min-h-11 w-full rounded-[13px] border border-border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const MatchColumns = ({
  headers,
  mapping,
  onChange,
  preview,
  canContinue,
  onBack,
  onNext,
}: {
  headers: string[];
  mapping: ImportMapping;
  onChange: (field: string, header: string | null) => void;
  preview: ImportedDonorRow[];
  canContinue: boolean;
  onBack: () => void;
  onNext: () => void;
}) => {
  const baseId = useId();
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {IMPORT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label
              htmlFor={`${baseId}-${key}`}
              className="mb-1 block text-[10px] font-medium uppercase tracking-[0.6px] text-muted-foreground"
            >
              {label}
            </label>
            <select
              id={`${baseId}-${key}`}
              className={selectClass}
              value={mapping[key] ?? ""}
              onChange={(e) => onChange(key, e.target.value || null)}
            >
              <option value="">Not mapped</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="rounded-[22px] bg-surface p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Preview
        </p>
        {preview.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Map a name or email column to see a preview.
          </p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {preview.map((row) => (
              <li
                key={row.source_row}
                className="rounded-[13px] bg-card px-3 py-2"
              >
                <span className="font-semibold">{row.full_name}</span>
                <span className="text-muted-foreground">
                  {[
                    row.email,
                    row.gifts[0] &&
                      `$${row.gifts[0].amount} on ${row.gifts[0].gift_date}`,
                  ]
                    .filter(Boolean)
                    .map((s) => ` · ${s}`)
                    .join("")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!canContinue && (
        <p role="alert" className="text-xs text-muted-foreground">
          Match at least a name, organization, or email column to continue.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className={quietPill}
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="button"
          className={inkPill}
          onClick={onNext}
          disabled={!canContinue}
        >
          Review
        </Button>
      </div>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-[18px] bg-surface p-3.5">
    <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
    <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
      {label}
    </div>
  </div>
);

const ResultView = ({
  result,
  onClose,
}: {
  result: IngestResult;
  onClose: () => void;
}) => (
  <div className="space-y-4">
    <div
      role="status"
      className="flex items-start gap-3 rounded-[13px] bg-good px-4 py-3 text-xs leading-relaxed text-good-foreground"
    >
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">
          {result.message ??
            `Imported ${result.donors ?? "your"} donors${result.gifts != null ? ` and ${result.gifts} gifts` : ""}.`}
        </p>
        <p className="mt-1">
          Review duplicates: any new possible matches appear in the banner on
          the outreach inbox, and nothing is merged until you approve it.
        </p>
      </div>
    </div>
    <div className="flex justify-end">
      <Button type="button" className={inkPill} onClick={onClose}>
        Done
      </Button>
    </div>
  </div>
);
