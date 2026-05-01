import { ExternalLink, Plus } from "lucide-react";
import { formatRelativeShort } from "./format";

type Props = {
  isLive: boolean;
  lastUpdate?: string;
  onNewSession: () => void;
};

const convexConsoleUrl =
  (import.meta.env.VITE_CONVEX_DASHBOARD_URL as string | undefined)?.trim() ||
  "http://127.0.0.1:6790";

export function Header({ isLive, lastUpdate, onNewSession }: Props) {
  return (
    <header className="header">
      <div className="brand">
        autoresearch <span className="sub">— lab ledger</span>
      </div>
      <div className="header-meta">
        <span className={`heartbeat ${isLive ? "live" : ""}`}>
          <span className={`dot ${isLive ? "" : "idle"}`} />
          <span>{isLive ? "live" : "idle"}</span>
        </span>
        {lastUpdate ? <span>updated {formatRelativeShort(lastUpdate)}</span> : null}
        <a
          className="btn btn-quiet btn-console"
          href={convexConsoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open Convex console"
        >
          <ExternalLink size={13} />
          console
        </a>
        <button type="button" className="btn btn-primary" onClick={onNewSession}>
          <Plus size={13} />
          new session
        </button>
      </div>
    </header>
  );
}
