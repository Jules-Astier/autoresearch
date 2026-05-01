import { useEffect, useMemo, useState } from "react";
import { formatRelativeShort } from "./format";

type MemoryNote = {
  _id: string;
  path: string;
  kind: string;
  content?: string;
  entries?: string[];
  byteLength?: number;
  contentHash?: string;
  updatedAtUtc: string;
};

type Props = {
  notes: MemoryNote[];
  memoryConfig?: any;
};

function pathLabel(p: string): string {
  const segs = p.split("/");
  return segs[segs.length - 1] || p;
}

function pathDir(p: string): string {
  const segs = p.split("/");
  return segs.slice(0, -1).join("/") || "/";
}

function compareNotes(a: MemoryNote, b: MemoryNote): number {
  // Files before directories before missing
  const order = (n: MemoryNote) =>
    n.kind === "file" ? 0 : n.kind === "directory" ? 1 : 2;
  const diff = order(a) - order(b);
  if (diff !== 0) return diff;
  return a.path.localeCompare(b.path);
}

export function NotesPanel({ notes, memoryConfig }: Props) {
  const enabled = memoryConfig?.enabled !== false && memoryConfig != null;

  const sorted = useMemo(() => [...notes].sort(compareNotes), [notes]);
  const files = useMemo(
    () => sorted.filter((n) => n.kind === "file"),
    [sorted],
  );
  const directories = useMemo(
    () => sorted.filter((n) => n.kind === "directory"),
    [sorted],
  );

  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    files[0]?.path ?? directories[0]?.path,
  );

  useEffect(() => {
    const fallbackPath = files[0]?.path ?? directories[0]?.path;
    if (!selectedPath || !sorted.some((n) => n.path === selectedPath)) {
      setSelectedPath(fallbackPath);
    }
  }, [directories, files, selectedPath, sorted]);

  const selected = sorted.find((n) => n.path === selectedPath);

  if (!enabled) {
    return (
      <div className="notes-panel-empty">
        <p>memory is disabled for this session.</p>
        <p className="notes-hint">
          enable memory in the session config to track durable research notes.
        </p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="notes-panel-empty">
        <p>no notes yet.</p>
        <p className="notes-hint">
          notes will appear after the memory keeper runs at the end of an
          experiment.
        </p>
      </div>
    );
  }

  return (
    <div className="notes-panel">
      <aside className="notes-index">
        {files.length > 0 ? (
          <div className="notes-group">
            <div className="notes-group-title">files</div>
            <ul className="notes-list">
              {files.map((note) => (
                <li
                  key={note._id}
                  className={`notes-item ${note.path === selectedPath ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="notes-item-button"
                    onClick={() => setSelectedPath(note.path)}
                  >
                    <span className="notes-item-name">
                      {pathLabel(note.path)}
                    </span>
                    <span className="notes-item-dir">{pathDir(note.path)}</span>
                    <span className="notes-item-when">
                      {formatRelativeShort(note.updatedAtUtc)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {directories.length > 0 ? (
          <div className="notes-group">
            <div className="notes-group-title">directories</div>
            <ul className="notes-list">
              {directories.map((note) => (
                <li
                  key={note._id}
                  className={`notes-item ${note.path === selectedPath ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="notes-item-button"
                    onClick={() => setSelectedPath(note.path)}
                  >
                    <span className="notes-item-name">{note.path}</span>
                    <span className="notes-item-dir">
                      {(note.entries?.length ?? 0)} entries
                    </span>
                    <span className="notes-item-when">
                      {formatRelativeShort(note.updatedAtUtc)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      <div className="notes-viewer">
        {selected ? (
          <>
            <div className="notes-viewer-head">
              <div className="notes-viewer-path">{selected.path}</div>
              <div className="notes-viewer-meta">
                <span>{selected.kind}</span>
                {selected.byteLength !== undefined ? (
                  <span>{selected.byteLength.toLocaleString()} bytes</span>
                ) : null}
                <span>updated {formatRelativeShort(selected.updatedAtUtc)}</span>
              </div>
            </div>
            {selected.kind === "file" ? (
              <pre className="notes-viewer-body">
                {selected.content || "(empty file)"}
              </pre>
            ) : selected.kind === "directory" ? (
              <ul className="notes-dir-entries">
                {(selected.entries ?? []).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
                {(selected.entries ?? []).length === 0 ? (
                  <li className="empty">(empty directory)</li>
                ) : null}
              </ul>
            ) : (
              <div className="notes-viewer-body">({selected.kind})</div>
            )}
          </>
        ) : (
          <div className="notes-panel-empty">select a note to view.</div>
        )}
      </div>
    </div>
  );
}
