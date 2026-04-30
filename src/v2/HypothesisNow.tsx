import { formatElapsed } from "./format";

type Props = {
  activeRun: any;
  experiment: any | undefined;
};

export function HypothesisNow({ activeRun, experiment }: Props) {
  if (!activeRun || !experiment) {
    return (
      <section className="hypothesis-now" aria-label="Active hypothesis">
        <div className="hypothesis-label">hypothesis now</div>
        <div className="hypothesis-empty">no run claimed — waiting on planner</div>
      </section>
    );
  }
  const elapsed = formatElapsed(activeRun.startedAtUtc ?? activeRun.claimedAtUtc);
  return (
    <section className="hypothesis-now" aria-label="Active hypothesis">
      <div className="hypothesis-label">hypothesis now · #{experiment.ordinal}</div>
      <p className="hypothesis-text">{experiment.hypothesis}</p>
      <div className="hypothesis-meta">
        run #{activeRun.runNumber} ·{" "}
        <span className="status-glyph running">●</span> {activeRun.status}
        {elapsed ? ` · ${elapsed} elapsed` : ""}
        {activeRun.workerId ? ` · ${activeRun.workerId}` : ""}
      </div>
    </section>
  );
}
