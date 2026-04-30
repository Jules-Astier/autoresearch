import { Terminal } from "lucide-react";
import { useState } from "react";
import { classNames } from "../utils/format";

type LogPanelProps = {
  stdout: string;
  stderr: string;
};

export function LogPanel({ stdout, stderr }: LogPanelProps) {
  const [active, setActive] = useState<"stdout" | "stderr">("stdout");
  const text = active === "stdout" ? stdout : stderr;
  const lineCount = text ? text.split("\n").length : 0;

  return (
    <section className="overflow-hidden rounded-lg border border-ink-800/70 bg-ink-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-ink-800/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-800/80 ring-1 ring-ink-700/50">
            <Terminal className="h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-ink-50">Logs</h2>
            <p className="font-mono text-[11px] text-ink-500">
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </p>
          </div>
        </div>
        <div className="inline-flex rounded-md bg-ink-800/60 p-0.5 ring-1 ring-ink-700/50">
          {(["stdout", "stderr"] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setActive(name)}
              className={classNames(
                "rounded px-3 py-1 font-mono text-[11px] transition",
                active === name
                  ? name === "stderr"
                    ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20"
                    : "bg-ink-700 text-ink-50"
                  : "text-ink-400 hover:text-ink-200"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </header>
      <div className="relative bg-[#08080a]">
        <pre
          className={classNames(
            "max-h-96 overflow-auto whitespace-pre-wrap break-all px-5 py-4 font-mono text-[11.5px] leading-[1.65]",
            active === "stderr" ? "text-rose-200/90" : "text-ink-200"
          )}
        >
          {text || <span className="text-ink-600">No log output.</span>}
        </pre>
      </div>
    </section>
  );
}
