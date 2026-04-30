import { ArrowDown, ArrowUp, Target } from "lucide-react";
import type { SessionSnapshot } from "../types";
import { classNames, formatMetric } from "../utils/format";

type MetricCardsProps = {
  session: SessionSnapshot;
};

export function MetricCards({ session }: MetricCardsProps) {
  const entries = Object.entries(session.best_metrics);
  const primaryMetric = session.metric_contract.primary_metric;

  if (entries.length === 0) {
    return (
      <Panel>
        <p className="text-[12px] text-ink-500">No numeric metrics recorded yet.</p>
      </Panel>
    );
  }

  // Sort: primary first
  const sorted = [...entries].sort(([a], [b]) => {
    if (a === primaryMetric) return -1;
    if (b === primaryMetric) return 1;
    return a.localeCompare(b);
  });

  return (
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {sorted.map(([name, value]) => {
        const direction = String(session.metric_contract.metric_directions[name] ?? "");
        const isPrimary = name === primaryMetric;
        const Icon = direction === "maximize" ? ArrowUp : direction === "minimize" ? ArrowDown : null;

        return (
          <div
            key={name}
            className={classNames(
              "group relative min-w-0 overflow-hidden rounded-lg border p-4 transition",
              isPrimary
                ? "border-indigo-500/30 bg-gradient-to-br from-indigo-500/[0.08] via-ink-900 to-ink-900"
                : "border-ink-800/70 bg-ink-900/40 hover:border-ink-700"
            )}
          >
            {isPrimary ? (
              <div className="absolute right-0 top-0 h-16 w-16 bg-gradient-to-bl from-indigo-500/10 to-transparent" />
            ) : null}

            <div className="relative flex items-center justify-between gap-2">
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
                {name}
              </p>
              {isPrimary ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-indigo-300 ring-1 ring-indigo-400/20">
                  <Target className="h-2.5 w-2.5" aria-hidden="true" />
                  Primary
                </span>
              ) : null}
            </div>

            <div className="mt-2.5 flex items-baseline gap-2">
              <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-ink-50">
                {formatMetric(value) || "—"}
              </p>
            </div>

            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-500">
              {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
              <span className="capitalize">{direction || "unspecified"}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-ink-800/70 bg-ink-900/40 p-4">{children}</section>;
}
