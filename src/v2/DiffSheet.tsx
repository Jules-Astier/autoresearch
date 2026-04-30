import { useMemo } from "react";
import { X } from "lucide-react";
import { formatRelativeShort, statusGlyph } from "./format";

type Props = {
  patch: any;
  onClose: () => void;
};

type DiffFile = {
  header: string;
  fileName: string;
  lines: Array<{ kind: "add" | "del" | "ctx" | "hunk"; content: string }>;
};

export function DiffSheet({ patch, onClose }: Props) {
  const parsed = useMemo(() => parseDiff(patch?.diff ?? ""), [patch?.diff]);
  if (!patch) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Patch diff">
        <header className="modal-head">
          <div>
            <div className="modal-title">
              <span className={`status-glyph ${patch.status}`}>{statusGlyph(patch.status)}</span>{" "}
              patch · <span className="mono">{(patch.contentHash ?? "").slice(0, 12)}</span>
            </div>
            <div className="modal-meta">
              {patch.changedFiles?.length ?? 0} files changed ·{" "}
              {formatRelativeShort(patch.createdAtUtc)}
              {patch.rejectionReason ? (
                <span style={{ color: "var(--oxblood)", marginLeft: 12 }}>
                  rejected: {patch.rejectionReason}
                </span>
              ) : null}
            </div>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <div className="modal-body">
          {parsed.length === 0 ? (
            <div className="empty">
              no diff stored.
              {patch.diffStat ? (
                <pre style={{ marginTop: 12 }} className="mono">{patch.diffStat}</pre>
              ) : null}
            </div>
          ) : (
            <div className="diff">
              {parsed.map((file, i) => (
                <div key={i} className="diff-file">
                  <div className="diff-file-head">{file.fileName}</div>
                  {file.lines.map((line, j) => (
                    <div key={j} className={`diff-line ${line.kind === "ctx" ? "" : line.kind}`}>
                      <span className="gutter">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : line.kind === "hunk" ? "@" : ""}
                      </span>
                      <span className="content">{line.content}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function parseDiff(raw: string): DiffFile[] {
  if (!raw || raw.trim().length === 0) return [];
  const lines = raw.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;

  for (const ln of lines) {
    if (ln.startsWith("diff --git")) {
      // start a new file
      const match = ln.match(/diff --git a\/(.+?) b\/(.+)$/);
      const fname = match ? match[2] : ln;
      current = { header: ln, fileName: fname, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) {
      // diff with no `diff --git` header — synthesize one
      current = { header: "", fileName: "(patch)", lines: [] };
      files.push(current);
    }
    if (
      ln.startsWith("index ") ||
      ln.startsWith("--- ") ||
      ln.startsWith("+++ ") ||
      ln.startsWith("new file mode") ||
      ln.startsWith("deleted file mode") ||
      ln.startsWith("similarity index") ||
      ln.startsWith("rename from") ||
      ln.startsWith("rename to")
    ) {
      continue;
    }
    if (ln.startsWith("@@")) {
      current.lines.push({ kind: "hunk", content: ln });
      continue;
    }
    if (ln.startsWith("+")) {
      current.lines.push({ kind: "add", content: ln.slice(1) });
      continue;
    }
    if (ln.startsWith("-")) {
      current.lines.push({ kind: "del", content: ln.slice(1) });
      continue;
    }
    current.lines.push({ kind: "ctx", content: ln.startsWith(" ") ? ln.slice(1) : ln });
  }

  return files;
}
