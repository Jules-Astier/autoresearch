// Lab-ledger formatting helpers.

export function formatMetricValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 100000 || abs < 0.0001)) return value.toExponential(2);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3);
  return value.toFixed(4);
}

export function formatDelta(delta: number | undefined): string {
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) return "±0";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatMetricValue(Math.abs(delta))}`;
}

export function formatRelativeShort(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString();
}

export function formatElapsed(startIso: string | undefined): string {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return "";
  const sec = Math.max(0, Math.round((Date.now() - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm.toString().padStart(2, "0")}m`;
}

export function statusGlyph(status: string): string {
  switch (status) {
    case "running":
    case "claimed":
      return "●";
    case "completed":
    case "complete":
    case "ok":
      return "✓";
    case "failed":
      return "✗";
    case "rejected":
      return "✗";
    case "rolled_back":
      return "↶";
    case "paused":
      return "‖";
    case "stopped":
      return "■";
    case "pending":
    case "queued":
      return "◌";
    case "approved":
      return "✓";
    default:
      return "·";
  }
}

export function metricDirection(metricContract: any, name: string): "maximize" | "minimize" {
  const list = Array.isArray(metricContract?.metrics) ? metricContract.metrics : [];
  const found = list.find((m: any) => m?.name === name);
  return String(found?.direction ?? "").toLowerCase() === "maximize"
    ? "maximize"
    : "minimize";
}

export function isImprovement(
  delta: number,
  direction: "maximize" | "minimize",
): boolean {
  if (delta === 0) return false;
  return direction === "maximize" ? delta > 0 : delta < 0;
}
