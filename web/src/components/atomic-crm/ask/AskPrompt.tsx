import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { completionFor } from "./askComplete";

/**
 * The Ask prompt: Enter asks, Shift+Enter adds a line, Tab accepts the
 * suggested example question (ghost text after what's typed). Tab only does
 * that while a suggestion shows; otherwise it moves focus as usual. Escape
 * hides the suggestion until the text changes.
 */
export const AskPrompt = ({
  value,
  onChange,
  onSubmit,
  pending,
  hint,
  compact = false,
  autoFocus = false,
  placeholder = "Who gave this quarter and hasn't been thanked yet?",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (question: string) => void;
  pending: boolean;
  hint?: ReactNode;
  compact?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) => {
  const promptId = useId();
  const hintId = useId();
  const completeId = useId();
  const ghostRef = useRef<HTMLDivElement>(null);
  // The text the suggestion was dismissed for (Escape); a new keystroke brings it back.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const completion = useMemo(
    () => (dismissedFor === value ? null : completionFor(value)),
    [value, dismissedFor],
  );

  const accept = () => {
    if (!completion) return;
    onChange(completion.question);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit(value);
      return;
    }
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      completion
    ) {
      event.preventDefault();
      accept();
      return;
    }
    if (event.key === "Escape" && completion) {
      event.preventDefault();
      event.stopPropagation(); // don't also close a surrounding panel
      setDismissedFor(value);
    }
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };

  const textClass = cn(
    "w-full rounded-[22px] px-4 pt-3 pr-16 pb-3 text-base break-words whitespace-pre-wrap",
    compact ? "min-h-[72px]" : "min-h-[96px]",
  );

  return (
    <form onSubmit={onFormSubmit} className="w-full">
      <label htmlFor={promptId} className="sr-only">
        Ask a question about your donors
      </label>
      <div className="relative rounded-[28px] border border-border bg-card p-2 text-left shadow-[0_12px_40px_#34302612] focus-within:ring-2 focus-within:ring-ring">
        <div className="relative">
          {/* Ghost text: the typed text (invisible) plus the rest of the suggestion. */}
          <div
            ref={ghostRef}
            aria-hidden="true"
            className={cn(
              textClass,
              "pointer-events-none absolute inset-0 overflow-hidden text-transparent",
            )}
          >
            {completion?.suffix != null && (
              <>
                {value}
                <span className="text-muted-foreground">
                  {completion.suffix}
                </span>
              </>
            )}
          </div>
          <textarea
            id={promptId}
            rows={compact ? 2 : 3}
            value={value}
            maxLength={500}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onScroll={(event) => {
              if (ghostRef.current)
                ghostRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            aria-describedby={hint ? `${hintId} ${completeId}` : completeId}
            placeholder={placeholder}
            className={cn(
              textClass,
              "relative block resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none",
            )}
          />
        </div>
        <button
          type="submit"
          disabled={!value.trim() || pending}
          aria-label={pending ? "Asking" : "Ask"}
          className="absolute right-3 bottom-3 grid size-11 place-items-center rounded-full bg-primary text-brand transition-opacity disabled:opacity-50 dark:text-primary-foreground"
        >
          {pending ? (
            <Loader2
              className="size-5 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <ArrowUp className="size-5" aria-hidden />
          )}
        </button>
      </div>

      {/* Visible for discoverability, and announced politely when the suggestion changes. */}
      <p
        id={completeId}
        aria-live="polite"
        className={cn(
          "mt-2 flex flex-wrap items-center gap-x-1.5 text-left text-xs text-muted-foreground",
          !completion && "sr-only",
          compact ? "justify-start" : "justify-center",
        )}
      >
        {completion && (
          <>
            <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] text-foreground">
              Tab
            </kbd>
            <span>to complete:</span>
            <button
              type="button"
              onClick={accept}
              className="inline-flex min-h-11 items-center rounded-full px-1 text-left text-foreground underline underline-offset-2 hover:bg-accent"
            >
              {completion.question}
            </button>
          </>
        )}
      </p>

      {hint && (
        <p
          id={hintId}
          className={cn(
            "mt-2 flex items-center gap-1.5 text-xs text-muted-foreground",
            compact ? "justify-start text-left" : "justify-center",
          )}
        >
          {hint}
        </p>
      )}
    </form>
  );
};
