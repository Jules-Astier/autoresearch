import { Plus } from "lucide-react";
import { formatRelativeShort } from "./format";

type Props = {
  isLive: boolean;
  lastUpdate?: string;
  onNewSession: () => void;
};

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
        <button type="button" className="btn btn-primary" onClick={onNewSession}>
          <Plus size={13} />
          new session
        </button>
      </div>
    </header>
  );
}
