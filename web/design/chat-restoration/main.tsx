import { useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../src/components/atomic-crm/misc/Markdown";
import { ArrowRight } from "lucide-react";
import "../../src/index.css";
import "../../src/components/atomic-crm/home/dashboard.css";
import {
  AgentReply,
  ConversationSuggestions,
  UserMessage,
} from "../../src/components/atomic-crm/home/Conversation";

type Message = { role: "user" | "assistant"; text: string };
const initial: Message[] = [
  { role: "user", text: "Add thank-you calls for them on Tuesday." },
  {
    role: "assistant",
    text: "Done. I added 3 calls to Tuesday, Nov 10, 10:00-11:00 on your calendar.",
  },
  { role: "user", text: "Who's late on a usual gift?" },
  {
    role: "assistant",
    text: "3 donors are past their usual gift: Marcus Bell (December), Elena Ruiz (Give Miami Day) and Rosa Delgado (monthly, card failed).",
  },
];

/** Separate dev entry: supplied reference content, no API calls or donor writes. */
export const Preview = () => {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setMessages((current) => [
      ...current,
      { role: "user", text: text.trim() },
      {
        role: "assistant",
        text: "Design preview only. In the app, this question goes to your agent.",
      },
    ]);
    setText("");
  };
  return (
    <main style={{ height: "100dvh", display: "grid", justifyItems: "center" }}>
      <section
        className="home-conversation"
        aria-label="Agent"
        style={{ height: "100%" }}
      >
        <header className="home-greeting">
          <h1 className="home-greeting-title">
            Good evening, <b>Denise.</b>
          </h1>
        </header>
        <div
          className="home-thread"
          role="log"
          aria-label="Conversation with the agent"
        >
          {messages.map((message, i) =>
            message.role === "user" ? (
              <UserMessage key={i} text={message.text} />
            ) : (
              <AgentReply key={i}>
                <Markdown className="home-agent-prose">{message.text}</Markdown>
              </AgentReply>
            ),
          )}
        </div>
        <div className="home-composer">
          <ConversationSuggestions
            suggestions={[
              "Enrich Priya Raman",
              "Who's late on a usual gift?",
              "Plan next week",
            ]}
            onSelect={(question) => {
              setText(question);
              input.current?.focus();
            }}
          />
          <form className="home-composer-input" onSubmit={send}>
            <input
              ref={input}
              aria-label="Ask the agent"
              placeholder="Ask the agent…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "8px 12px",
                background: "transparent",
                outline: "none",
                font: "inherit",
              }}
            />
            <button
              aria-label="Send"
              type="submit"
              disabled={!text.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-border disabled:opacity-50"
            >
              <ArrowRight size={20} aria-hidden="true" />
            </button>
          </form>
        </div>
      </section>
      <small
        style={{
          position: "fixed",
          right: 12,
          top: 6,
          fontSize: 10,
          color: "#6b7073",
        }}
      >
        Design preview · sample conversation
      </small>
    </main>
  );
};
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
