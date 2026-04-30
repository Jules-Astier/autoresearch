import { formatRelativeShort } from "./format";

type Message = {
  _id: string;
  role: string;
  source: string;
  content: string;
  createdAtUtc: string;
};

type Props = {
  messages: Message[];
};

export function AgentDialogue({ messages }: Props) {
  // newest first from query; we want chronological in dialogue, so reverse a slice
  const turns = [...messages].slice(0, 20).reverse();

  return (
    <div className="rail-card">
      <div className="rail-head">
        <span className="rail-title">planner ↔ reviewer</span>
        <span className="rail-meta">{messages.length} turns</span>
      </div>
      {turns.length === 0 ? (
        <div className="tape-empty">no agent dialogue yet.</div>
      ) : (
        <div className="dialogue">
          {turns.map((m) => {
            const who = (m.source ?? m.role ?? "agent").toLowerCase();
            const whoClass = who.includes("planner")
              ? "planner"
              : who.includes("reviewer")
                ? "reviewer"
                : "";
            return (
              <div key={m._id} className="dialogue-turn">
                <div className="dialogue-source">
                  <span className={`who ${whoClass}`}>{m.source ?? m.role}</span>
                  <span>{formatRelativeShort(m.createdAtUtc)}</span>
                </div>
                <div className="dialogue-content">{m.content}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
