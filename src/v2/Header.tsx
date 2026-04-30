import { formatRelativeShort } from "./format";

type Props = {
  isLive: boolean;
  lastUpdate?: string;
};

export function Header({ isLive, lastUpdate }: Props) {
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
      </div>
    </header>
  );
}
