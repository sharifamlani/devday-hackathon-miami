import type { ReactNode } from "react";

/** Shared by the live agent, sample Ask thread, and the local design preview. */
export const UserMessage = ({ text }: { text: string }) => (
  <p className="home-user-message">
    <span className="sr-only">You: </span>
    {text}
  </p>
);

export const AgentReply = ({ children }: { children: ReactNode }) => (
  <article className="home-agent-message">
    <span className="home-agent-label">Agent</span>
    <div className="home-agent-body">{children}</div>
  </article>
);

export const HOME_SUGGESTIONS = [
  "Who needs a thank-you?",
  "Who's late on a usual gift?",
  "Plan next week",
] as const;

/** Choosing a prompt fills the composer; sending remains an explicit action. */
export const ConversationSuggestions = ({
  onSelect,
  disabled = false,
  suggestions = HOME_SUGGESTIONS,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
  suggestions?: readonly string[];
}) => (
  <div
    className="home-suggestions"
    role="group"
    aria-label="Suggested questions"
  >
    {suggestions.map((text) => (
      <button
        key={text}
        type="button"
        className="home-suggestion"
        disabled={disabled}
        onClick={() => onSelect(text)}
      >
        {text}
      </button>
    ))}
  </div>
);
