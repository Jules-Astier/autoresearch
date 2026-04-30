import { CheckCircle2, FlaskConical } from "lucide-react";
import type { SessionSnapshot } from "../types";
import { classNames, formatDate, formatMetric } from "../utils/format";
import { StatusBadge } from "./StatusBadge";

type ExperimentTableProps = {
  session: SessionSnapshot;
};

export function ExperimentTable({ session }: ExperimentTableProps) {
  const metricNames = Array.from(
    new Set(session.experiments.flatMap((e) => Object.keys(e.metrics)))
  ).sort();
  const primaryMetric = session.metric_contract.primary_metric;

  return (
    <section className="overflow-hidden rounded-lg border border-ink-800/70 bg-ink-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-ink-800/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-800/80 ring-1 ring-ink-700/50">
            <FlaskConical className="h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-ink-50">Experiments</h2>
            <p className="text-[11px] text-ink-500">
              {session.experiments.length} total · {session.promoted_count} promoted
            </p>
          </div>
        </div>
      </header>

      {session.experiments.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-[12px] text-ink-500">
          No experiments yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="border-b border-ink-800/60 bg-ink-900/40">
                <Th>Experiment</Th>
                <Th>Status</Th>
                <Th className="min-w-[16rem]">Hypothesis</Th>
                {metricNames.map((name) => (
                  <Th
                    key={name}
                    className={classNames("text-right font-mono", name === primaryMetric && "text-indigo-300")}
                  >
                    {name}
                  </Th>
                ))}
                <Th>Promotion</Th>
                <Th className="text-right">Created</Th>
              </tr>
            </thead>
            <tbody>
              {session.experiments.map((experiment, idx) => (
                <tr
                  key={`${experiment.run_id}-${experiment.experiment_id || idx}`}
                  className={classNames(
                    "group border-b border-ink-800/40 transition last:border-0 hover:bg-ink-800/30",
                    experiment.promoted && "bg-emerald-500/[0.03]"
                  )}
                >
                  <td className="whitespace-nowrap px-5 py-3 align-top">
                    <div className="flex items-start gap-2">
                      {experiment.promoted ? (
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                      ) : (
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-700" aria-hidden="true" />
                      )}
                      <span className="font-mono text-[12px] text-ink-100">
                        {experiment.experiment_id || experiment.run_id}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 align-top">
                    <StatusBadge status={experiment.status} size="sm" />
                  </td>
                  <td className="px-5 py-3 align-top">
                    <p className="text-ink-200">{experiment.hypothesis || <span className="text-ink-500">—</span>}</p>
                    {experiment.comment ? (
                      <p className="mt-1 text-[11px] text-ink-500">{experiment.comment}</p>
                    ) : null}
                  </td>
                  {metricNames.map((name) => {
                    const v = experiment.metrics[name];
                    const isPrimary = name === primaryMetric;
                    return (
                      <td
                        key={name}
                        className={classNames(
                          "whitespace-nowrap px-5 py-3 text-right align-top font-mono tabular-nums",
                          isPrimary ? "font-semibold text-ink-50" : "text-ink-300"
                        )}
                      >
                        {v === undefined ? <span className="text-ink-600">—</span> : formatMetric(v)}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-5 py-3 align-top">
                    {experiment.promoted ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-400/20">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        promoted
                      </span>
                    ) : (
                      <span className="text-ink-600">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right align-top font-mono text-[11px] text-ink-500">
                    {formatDate(experiment.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={classNames(
        "whitespace-nowrap px-5 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500",
        className
      )}
    >
      {children}
    </th>
  );
}
