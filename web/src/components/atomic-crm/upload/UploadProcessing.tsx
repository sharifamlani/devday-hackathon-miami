import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import type { FilesSummary } from "../onboarding/onboardingState";
import "./upload-processing.css";

/** The ingest API returns one final response, so the in-flight bar is an estimate, capped below done. */
export const UploadProcessing = ({
  pending,
  summary,
  error,
  onContinue,
  onRetry,
  onBack,
  onReviewDuplicates,
  demo = false,
}: {
  pending: boolean;
  summary: FilesSummary | null;
  error?: string;
  onContinue: () => void;
  onRetry?: () => void;
  onBack?: () => void;
  onReviewDuplicates?: () => void;
  demo?: boolean;
}) => {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [estimate, setEstimate] = useState(4);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const startedAt = useRef(performance.now());
  useEffect(() => {
    if (!pending) return;
    setReady(false);
    setSettled(false);
    setEstimate(4);
    const started = performance.now();
    startedAt.current = started;
    const timer = window.setInterval(() => {
      setEstimate(
        Math.min(
          94,
          Math.floor(
            4 +
              90 *
                (1 -
                  Math.exp(
                    (-(performance.now() - started) * (demo ? 4 : 1)) / 22000,
                  )),
          ),
        ),
      );
    }, 200);
    return () => window.clearInterval(timer);
  }, [pending, demo]);
  useEffect(() => {
    if (pending || !summary) return;
    // Let small imports show one gentle shuffle; 100 still requires a successful API response.
    const finishing = window.setInterval(
      () => setEstimate((value) => Math.min(94, value + 7)),
      200,
    );
    const timer = window.setTimeout(
      () => {
        window.clearInterval(finishing);
        setSettled(true);
      },
      Math.max(0, 3200 - (performance.now() - startedAt.current)),
    );
    return () => {
      window.clearInterval(finishing);
      window.clearTimeout(timer);
    };
  }, [pending, summary]);
  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => setReady(true), 950);
    return () => window.clearTimeout(timer);
  }, [settled]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [ready, error]);
  const progress = settled ? 100 : estimate;
  const number = (value: number | null | undefined) =>
    value == null ? "Checked" : value.toLocaleString("en-US");
  return (
    <section
      className="upload-processing"
      aria-labelledby={headingId}
      aria-busy={(!ready && !error) || undefined}
    >
      {demo && (
        <p className="upload-demo">Animation preview · sample results</p>
      )}
      <p className="upload-wordmark">gatherly</p>
      {ready && summary ? (
        <div className="upload-receipt">
          <span className="upload-success-mark">
            <Check size={20} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <h1 id={headingId} ref={heading} tabIndex={-1}>
            Your donor data is ready.
          </h1>
          <p className="upload-lede">A clearer picture of your people.</p>
          <ul className="upload-result-tiles" aria-label="Import results">
            <li>
              <Check size={16} aria-hidden="true" />
              <div>
                <strong>{number(summary.people)}</strong>
                <span>
                  {summary.people === 1
                    ? "Account recognized"
                    : "Accounts recognized"}
                </span>
              </div>
            </li>
            <li>
              <Check size={16} aria-hidden="true" />
              <div>
                <strong>{number(summary.duplicatesRemoved)}</strong>
                <span>
                  {summary.duplicatesRemoved == null
                    ? "Duplicate check complete"
                    : summary.duplicatesRemoved === 1
                      ? "Duplicate removed"
                      : "Duplicates removed"}
                </span>
              </div>
            </li>
          </ul>
          {(summary.duplicates ?? 0) > 0 && (
            <p className="upload-review-note">
              {summary.duplicates} possible{" "}
              {summary.duplicates === 1
                ? "match still needs"
                : "matches still need"}{" "}
              review.
              {onReviewDuplicates && (
                <>
                  {" "}
                  <button type="button" onClick={onReviewDuplicates}>
                    Review matches
                  </button>
                </>
              )}
            </p>
          )}
          <button type="button" className="upload-primary" onClick={onContinue}>
            Create organization profile
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="upload-loading">
          <div
            className={`upload-folder-stage${settled || error ? " is-still" : ""}`}
            aria-hidden="true"
          >
            <div className="upload-folder-art">
              <img
                className="upload-box upload-box-back"
                src="/upload-art/file-box.png"
                alt=""
                draggable={false}
              />
              {[1, 2, 3, 4, 5].map((index) => (
                <img
                  key={index}
                  className={`upload-folder folder-${index}`}
                  src="/upload-art/folder.png"
                  alt=""
                  draggable={false}
                />
              ))}
              <img
                className="upload-box upload-box-front"
                src="/upload-art/file-box.png"
                alt=""
                draggable={false}
              />
            </div>
          </div>
          <h1 id={headingId} ref={heading} tabIndex={-1}>
            {error
              ? "Let’s try that again."
              : settled
                ? "Everything’s in place."
                : "Bringing your data together."}
          </h1>
          {error ? (
            <>
              <p className="upload-error" role="alert">
                {error}
              </p>
              <div className="upload-error-actions">
                {onRetry && (
                  <button
                    type="button"
                    className="upload-primary"
                    onClick={onRetry}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Try again
                  </button>
                )}
                {onBack && (
                  <button
                    type="button"
                    className="upload-text-button"
                    onClick={onBack}
                  >
                    Back to upload
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="upload-progress-wrap">
                <div
                  role="progressbar"
                  aria-label={
                    settled ? "Import complete" : "Estimated import progress"
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  className="upload-progress"
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p aria-hidden="true">{progress}%</p>
              </div>
              <p className="upload-phase" role="status">
                {settled
                  ? "Ready for your next step."
                  : "Reading files and recognizing accounts."}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
};
