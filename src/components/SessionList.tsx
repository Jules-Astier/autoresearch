import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { SessionSnapshot } from "../types";
import { classNames, formatMetric, formatRelative } from "../utils/format";

type SessionListProps = {
  sessions: SessionSnapshot[];
  selectedId?: string;
  onSelect: (sessionId: string) => void;
};

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q)
    );
  }, [sessions, query]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Sessions <span className="text-ink-600">· {sessions.length}</span>
        </h2>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions"
          className="h-8 w-full rounded-md border border-ink-800 bg-ink-900/60 pl-8 pr-2.5 text-[12px] text-ink-100 placeholder:text-ink-500 focus:border-ink-600 focus:outline-none focus:ring-1 focus:ring-ink-700"
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-500">No sessions match.</p>
        ) : (
          filtered.map((session) => (
            <SessionRow
              key={session.session_id}
              session={session}
              selected={session.session_id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}

function SessionRow({
  session,
  selected,
  onSelect
}: {
  session: SessionSnapshot;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const primaryMetric = session.metric_contract.primary_metric;
  const max = session.state.max_experiments;
  const progress = max && max > 0 ? Math.min(1, session.completed_experiments / max) : 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(session.session_id)}
      className={classNames(
        "group relative min-w-0 overflow-hidden rounded-md border px-3 py-2.5 text-left transition",
        selected
          ? "border-ink-700 bg-gradient-to-br from-ink-800/80 to-ink-900 shadow-lg shadow-black/20"
          : "border-ink-800/70 bg-ink-900/40 hover:border-ink-700 hover:bg-ink-900/80"
      )}
    >
      {selected ? (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-indigo-400" aria-hidden="true" />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            className={classNames(
              "truncate text-[13px] font-semibold",
              selected ? "text-ink-50" : "text-ink-100"
            )}
            title={session.title}
          >
            {session.title}
          </h3>
          <p className="truncate font-mono text-[10px] text-ink-500">{session.session_id}</p>
        </div>
        <StatusDot status={session.status} />
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-500">
          {primaryMetric || "metric"}
        </span>
        <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-ink-100">
          {formatMetric(session.best_metrics[primaryMetric]) || "—"}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className={classNames(
            "h-full rounded-full transition-all",
            selected ? "bg-indigo-400" : "bg-ink-600 group-hover:bg-ink-500"
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
        <span className="font-mono tabular-nums">
          {session.completed_experiments}
          {max ? <span className="text-ink-600">/{max}</span> : null}
          <span className="ml-1">runs</span>
          {session.promoted_count > 0 ? (
            <span className="ml-1.5 text-emerald-400">· {session.promoted_count} promoted</span>
          ) : null}
        </span>
        <span className="truncate">{formatRelative(session.state.heartbeat_at_utc)}</span>
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const tone =
    s.includes("fail") || s.includes("error")
      ? { color: "bg-rose-400", pulse: false }
      : s.includes("running") || s.includes("active")
        ? { color: "bg-sky-400", pulse: true }
        : s.includes("complete") || s.includes("ok") || s.includes("ready")
          ? { color: "bg-emerald-400", pulse: false }
          : { color: "bg-ink-500", pulse: false };

  return (
    <span className="relative mt-1 flex h-2 w-2 shrink-0" title={status}>
      {tone.pulse ? <span className={classNames("absolute inset-0 animate-ping rounded-full opacity-70", tone.color)} /> : null}
      <span className={classNames("relative h-2 w-2 rounded-full", tone.color)} />
    </span>
  );
}
