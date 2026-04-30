import { classNames } from "../utils/format";

type StatusBadgeProps = {
  status: string;
  size?: "sm" | "md";
};

type Tone = {
  dot: string;
  ring: string;
  text: string;
  pulse: boolean;
};

function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (s.includes("fail") || s.includes("error")) {
    return { dot: "bg-rose-400", ring: "ring-rose-400/20", text: "text-rose-300", pulse: false };
  }
  if (s.includes("running") || s.includes("active") || s.includes("pending")) {
    return { dot: "bg-sky-400", ring: "ring-sky-400/20", text: "text-sky-300", pulse: true };
  }
  if (s.includes("ready") || s.includes("ok") || s.includes("complete") || s.includes("success") || s.includes("promoted")) {
    return { dot: "bg-emerald-400", ring: "ring-emerald-400/20", text: "text-emerald-300", pulse: false };
  }
  return { dot: "bg-zinc-400", ring: "ring-zinc-400/20", text: "text-zinc-300", pulse: false };
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const tone = toneFor(status || "unknown");
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const padding = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full bg-ink-800/60 font-medium ring-1",
        tone.ring,
        tone.text,
        padding
      )}
    >
      <span className={classNames("relative flex shrink-0", dotSize)}>
        {tone.pulse ? (
          <span className={classNames("absolute inset-0 rounded-full opacity-60 animate-ping", tone.dot)} />
        ) : null}
        <span className={classNames("relative rounded-full", tone.dot, dotSize)} />
      </span>
      <span className="truncate">{status || "unknown"}</span>
    </span>
  );
}
