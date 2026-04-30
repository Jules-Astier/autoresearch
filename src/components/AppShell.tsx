import { ExternalLink, RefreshCw, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { classNames } from "../utils/format";

type AppShellProps = {
  runtimeRoot?: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  actionLabel?: string;
  consoleUrl?: string;
  children: ReactNode;
};

export function AppShell({
  runtimeRoot,
  isRefreshing,
  onRefresh,
  actionLabel = "Refresh",
  consoleUrl,
  children
}: AppShellProps) {
  return (
    <div className="relative min-h-screen bg-ink-950 text-ink-100">
      {/* Ambient gradient backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[32rem] w-[32rem] rounded-full bg-indigo-500/[0.06] blur-3xl" />
        <div className="absolute -top-20 right-0 h-[28rem] w-[28rem] rounded-full bg-emerald-500/[0.04] blur-3xl" />
      </div>

      <header className="sticky top-0 z-20 border-b border-ink-800/60 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[110rem] items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold tracking-tight text-ink-50">
                Autoresearch
              </h1>
              <p className="truncate font-mono text-[11px] text-ink-500">{runtimeRoot || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator active={isRefreshing} />
            {consoleUrl ? (
              <a
                href={consoleUrl}
                target="_blank"
                rel="noreferrer"
                className={classNames(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-700/80 bg-ink-800/40 px-2.5 text-[12px] font-medium text-ink-200 transition",
                  "hover:border-ink-600 hover:bg-ink-800 hover:text-ink-50"
                )}
              >
                <TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Console
                <ExternalLink className="h-3 w-3 text-ink-500" aria-hidden="true" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={onRefresh}
              className={classNames(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-700/80 bg-ink-800/40 px-2.5 text-[12px] font-medium text-ink-200 transition",
                "hover:border-ink-600 hover:bg-ink-800 hover:text-ink-50"
              )}
            >
              <RefreshCw
                className={classNames("h-3.5 w-3.5", isRefreshing && "animate-spin")}
                aria-hidden="true"
              />
              {actionLabel}
            </button>
          </div>
        </div>
      </header>
      <main className="relative mx-auto max-w-[110rem] px-6 py-6">{children}</main>
    </div>
  );
}

function Logo() {
  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/20">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M14 7h7v7" />
      </svg>
    </div>
  );
}

function LiveIndicator({ active }: { active: boolean }) {
  return (
    <div className="hidden items-center gap-1.5 rounded-md bg-ink-800/40 px-2 py-1 sm:inline-flex">
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={classNames(
            "absolute inset-0 rounded-full bg-emerald-400 opacity-60",
            active ? "animate-ping" : ""
          )}
        />
        <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">Live</span>
    </div>
  );
}
