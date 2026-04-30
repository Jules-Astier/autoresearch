import { useEffect, useRef } from "react";

type LogLine = {
  _id: string;
  stream: string;
  chunk: string;
};

type Props = {
  logs: LogLine[];
  activeRun: any | undefined;
};

export function LiveTape({ logs, activeRun }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // pin to bottom on new output, only if user hasn't scrolled up
    const el = ref.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="rail-card">
      <div className="rail-head">
        <span className="rail-title">live tape</span>
        <span className="rail-meta">
          {activeRun
            ? `run #${activeRun.runNumber} · ${activeRun.status}`
            : "no active run"}
        </span>
      </div>
      {logs.length === 0 ? (
        <div className="tape-empty">
          {activeRun ? "stream is quiet — run is alive but not emitting." : "no live output."}
        </div>
      ) : (
        <div className="tape" ref={ref}>
          {logs.map((l) => (
            <span key={l._id} className={`stream-${l.stream}`}>
              {l.chunk}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
