import { useState, type FormEvent } from "react";
import { FolderOpen, Loader2, X } from "lucide-react";

export type NewSessionPayload = {
  slug: string;
  title: string;
  repoPath: string;
  benchmarkCommand: string;
  targetExperimentCount: number;
  maxConcurrentRuns: number;
  editablePaths: string[];
  immutablePaths: string[];
  metricContract: {
    primaryMetric?: string;
    direction?: "minimize" | "maximize";
    rankingMode?: "lexicographic" | "weighted_score" | string;
    metrics: Array<{
      name: string;
      direction: "minimize" | "maximize";
      role?: "objective" | "constraint" | string;
    }>;
  };
  baseRef?: string;
  runtimeConfigPaths?: string[];
  modelIoContract?: string;
};

type Props = {
  onClose: () => void;
  onCreate: (payload: NewSessionPayload) => Promise<void>;
};

type Draft = {
  workspacePath: string;
  title: string;
  slug: string;
  baseRef: string;
  benchmarkCommand: string;
  targetExperimentCount: string;
  maxConcurrentRuns: string;
  editablePaths: string;
  immutablePaths: string;
  runtimeConfigPaths: string;
  modelIoContract: string;
  topObjectiveMetric: string;
  direction: "minimize" | "maximize";
};

const initialDraft: Draft = {
  workspacePath: "",
  title: "",
  slug: "",
  baseRef: "HEAD",
  benchmarkCommand: "",
  targetExperimentCount: "20",
  maxConcurrentRuns: "1",
  editablePaths: "src/**",
  immutablePaths: "data/**",
  runtimeConfigPaths: "",
  modelIoContract: "Preserve the existing public inputs and metric output.",
  topObjectiveMetric: "",
  direction: "minimize",
};

export function NewSessionDialog({ onClose, onCreate }: Props) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [isPicking, setIsPicking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !isCreating;

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function pickWorkspace() {
    setError(null);
    setIsPicking(true);
    try {
      const response = await fetch("/api/local/pick-directory", { method: "POST" });
      const body = (await response.json()) as { path?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(body.error || "Folder picker failed.");
      }
      if (!body.path) {
        return;
      }

      const name = leafName(body.path);
      setDraft((current) => ({
        ...current,
        workspacePath: body.path ?? "",
        title: current.title || titleFromName(name),
        slug: current.slug || slugify(name),
      }));
    } catch (pickError) {
      const message =
        pickError instanceof Error ? pickError.message : "Folder picker failed.";
      setError(`${message} You can paste an absolute path instead.`);
    } finally {
      setIsPicking(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = validateDraft(draft);
    if (problems.length > 0) {
      setError(problems[0]);
      return;
    }

    setError(null);
    setIsCreating(true);
    try {
      const payload: NewSessionPayload = {
        slug: slugify(draft.slug),
        title: draft.title.trim(),
        repoPath: draft.workspacePath.trim(),
        benchmarkCommand: draft.benchmarkCommand.trim(),
        targetExperimentCount: parsePositiveInteger(draft.targetExperimentCount),
        maxConcurrentRuns: parseNonNegativeInteger(draft.maxConcurrentRuns),
        editablePaths: pathList(draft.editablePaths),
        immutablePaths: pathList(draft.immutablePaths),
        metricContract: {
          rankingMode: "lexicographic",
          metrics: [
            {
              name: draft.topObjectiveMetric.trim(),
              direction: draft.direction,
              role: "objective",
            },
          ],
        },
      };

      const baseRef = draft.baseRef.trim();
      const runtimeConfigPaths = pathList(draft.runtimeConfigPaths);
      const modelIoContract = draft.modelIoContract.trim();
      if (baseRef) payload.baseRef = baseRef;
      if (runtimeConfigPaths.length > 0) payload.runtimeConfigPaths = runtimeConfigPaths;
      if (modelIoContract) payload.modelIoContract = modelIoContract;

      await onCreate(payload);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal new-session-modal"
        aria-modal="true"
        aria-labelledby="new-session-title"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <div className="modal-meta">session intake</div>
            <h2 className="modal-title" id="new-session-title">
              new research session
            </h2>
          </div>
          <button type="button" className="btn btn-quiet icon-btn" onClick={onClose}>
            <X size={15} />
            <span className="sr-only">close</span>
          </button>
        </div>

        <div className="modal-body new-session-body">
          <div className="new-session-grid">
            <label className="field new-session-wide">
              <span className="field-label">base workspace folder</span>
              <span className="path-row">
                <input
                  className="input path-input"
                  value={draft.workspacePath}
                  onChange={(event) => update("workspacePath", event.target.value)}
                  placeholder="/absolute/path/to/repo"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={pickWorkspace}
                  disabled={isPicking || isCreating}
                >
                  {isPicking ? <Loader2 size={13} className="spin" /> : <FolderOpen size={13} />}
                  browse
                </button>
              </span>
            </label>

            <label className="field">
              <span className="field-label">title</span>
              <input
                className="input"
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">slug</span>
              <input
                className="input"
                value={draft.slug}
                onChange={(event) => update("slug", event.target.value)}
                onBlur={() => update("slug", slugify(draft.slug))}
              />
            </label>

            <label className="field">
              <span className="field-label">benchmark command</span>
              <input
                className="input"
                value={draft.benchmarkCommand}
                onChange={(event) => update("benchmarkCommand", event.target.value)}
                placeholder="npm test -- --json"
              />
            </label>

            <label className="field">
              <span className="field-label">base ref</span>
              <input
                className="input"
                value={draft.baseRef}
                onChange={(event) => update("baseRef", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">target experiments</span>
              <input
                className="input"
                type="number"
                min={1}
                value={draft.targetExperimentCount}
                onChange={(event) => update("targetExperimentCount", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">max runners</span>
              <input
                className="input"
                type="number"
                min={0}
                value={draft.maxConcurrentRuns}
                onChange={(event) => update("maxConcurrentRuns", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">top objective</span>
              <input
                className="input"
                value={draft.topObjectiveMetric}
                onChange={(event) => update("topObjectiveMetric", event.target.value)}
                placeholder="validation_loss"
              />
            </label>

            <label className="field">
              <span className="field-label">direction</span>
              <select
                className="select"
                value={draft.direction}
                onChange={(event) =>
                  update("direction", event.target.value as Draft["direction"])
                }
              >
                <option value="minimize">minimize</option>
                <option value="maximize">maximize</option>
              </select>
            </label>

            <label className="field new-session-wide">
              <span className="field-label">editable paths</span>
              <textarea
                className="input textarea"
                value={draft.editablePaths}
                onChange={(event) => update("editablePaths", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">immutable paths</span>
              <textarea
                className="input textarea"
                value={draft.immutablePaths}
                onChange={(event) => update("immutablePaths", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">runtime config paths</span>
              <textarea
                className="input textarea"
                value={draft.runtimeConfigPaths}
                onChange={(event) => update("runtimeConfigPaths", event.target.value)}
              />
            </label>

            <label className="field new-session-wide">
              <span className="field-label">model io contract</span>
              <textarea
                className="input textarea"
                value={draft.modelIoContract}
                onChange={(event) => update("modelIoContract", event.target.value)}
              />
            </label>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {isCreating ? <Loader2 size={13} className="spin" /> : null}
            create session
          </button>
        </div>
      </form>
    </div>
  );
}

function validateDraft(draft: Draft): string[] {
  const problems: string[] = [];
  if (!draft.workspacePath.trim()) problems.push("Choose a base workspace folder.");
  if (!draft.title.trim()) problems.push("Add a session title.");
  if (!draft.slug.trim() || !slugify(draft.slug)) problems.push("Add a session slug.");
  if (!draft.benchmarkCommand.trim()) problems.push("Add a benchmark command.");
  if (pathList(draft.editablePaths).length === 0) problems.push("Add at least one editable path.");
  if (!draft.topObjectiveMetric.trim()) problems.push("Add a top objective.");
  if (!Number.isInteger(Number(draft.targetExperimentCount)) || Number(draft.targetExperimentCount) < 1) {
    problems.push("Target experiments must be a positive integer.");
  }
  if (!Number.isInteger(Number(draft.maxConcurrentRuns)) || Number(draft.maxConcurrentRuns) < 0) {
    problems.push("Max runners must be a non-negative integer.");
  }
  return problems;
}

function pathList(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string): number {
  return Math.max(1, Number.parseInt(value, 10));
}

function parseNonNegativeInteger(value: string): number {
  return Math.max(0, Number.parseInt(value, 10));
}

function leafName(value: string): string {
  const normalized = value.replace(/[\\/]+$/u, "");
  const parts = normalized.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) || "workspace";
}

function titleFromName(value: string): string {
  return value
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}
