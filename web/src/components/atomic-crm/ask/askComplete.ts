import { EXAMPLE_QUESTIONS } from "../providers/local/ask";

/** A Tab completion for the Ask prompt. */
export interface Completion {
  /** The whole question Tab puts in the prompt. */
  question: string;
  /**
   * The rest of the question after what was typed, shown as ghost text
   * after the caret. null when the match isn't a prefix (word match): the
   * hint below the prompt shows the whole question instead.
   */
  suffix: string | null;
}

const fold = (text: string) => text.toLowerCase().replace(/’/g, "'");
const words = (text: string) =>
  fold(text)
    .split(/[^a-z0-9']+/)
    .filter(Boolean);

/**
 * The best example question for what's typed so far: a case-insensitive
 * prefix match first, else one whose words start with every typed word
 * ("gone quiet" → "Who needs outreach because they've gone quiet?").
 * null for fewer than 3 typed characters, more than one line, or a
 * question already typed in full.
 */
export const completionFor = (
  draft: string,
  candidates: readonly string[] = EXAMPLE_QUESTIONS,
): Completion | null => {
  if (draft.includes("\n")) return null;
  const typed = fold(draft);
  if (typed.trim().length < 3) return null;
  if (candidates.some((c) => fold(c).trim() === typed.trim())) return null;

  const prefix = candidates.find(
    (c) => fold(c).startsWith(typed) && c.length > draft.length,
  );
  if (prefix) return { question: prefix, suffix: prefix.slice(draft.length) };

  const typedWords = words(draft);
  if (typedWords.length === 0) return null;
  let best: { question: string; at: number } | null = null;
  for (const candidate of candidates) {
    const own = words(candidate);
    const at = own.findIndex((w) => w.startsWith(typedWords[0]));
    const all = typedWords.every((t) => own.some((w) => w.startsWith(t)));
    // Fewer leading words skipped reads as the closer match.
    if (all && at >= 0 && (!best || at < best.at))
      best = { question: candidate, at };
  }
  return best ? { question: best.question, suffix: null } : null;
};
