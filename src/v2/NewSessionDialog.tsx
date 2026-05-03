import { useState, type FormEvent } from "react";
import { CheckCircle2, FileJson, FolderOpen, Loader2, RefreshCw, X } from "lucide-react";

export type NewSessionPayload = {
  slug: string;
  title: string;
  repoPath: string;
  benchmarkCommand: string;
  computeBudget?: { seconds?: number; [key: string]: unknown } | number | string;
  targetExperimentCount: number;
  maxConcurrentRuns: number;
  maxPlannedConcurrentExperiments?: number;
  preemptivePlanning?: boolean;
  editablePaths: string[];
  immutablePaths: string[];
  metricContract: {
    primaryMetric?: string;
    direction?: "minimize" | "maximize";
    rankingMode?: "lexicographic" | "weighted_score" | string;
    metrics?: Array<{
      name: string;
      direction: "minimize" | "maximize";
      role?: "objective" | "constraint" | string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  baseRef?: string;
  metricParserCommand?: string;
  runtimeConfigPaths?: string[];
  artifactContract?: {
    required?: boolean;
    artifacts?: Array<{
      path: string;
      kind?: string;
      mimeType?: string;
      sourcePath?: string;
      required?: boolean;
    }>;
  };
  modelIoContract?: string;
  agent?: unknown;
  sandbox?: { environment?: string; backend?: string; provider?: string; [key: string]: unknown } | string;
  earlyStopping?: unknown;
};

type Props = {
  onClose: () => void;
  onCreate: (payload: NewSessionPayload) => Promise<void>;
};

type LoadResponse = {
  payload?: NewSessionPayload;
  error?: string;
};

export function NewSessionDialog({ onClose, onCreate }: Props) {
  const [sessionDir, setSessionDir] = useState("");
  const [payload, setPayload] = useState<NewSessionPayload | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickSessionDirectory() {
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
      setSessionDir(body.path);
      await loadSessionDirectory(body.path);
    } catch (pickError) {
      const message =
        pickError instanceof Error ? pickError.message : "Folder picker failed.";
      setError(`${message} You can paste a session directory path instead.`);
    } finally {
      setIsPicking(false);
    }
  }

  async function loadSessionDirectory(path: string = sessionDir) {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Choose a session directory containing session.json.");
      setPayload(null);
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/local/read-session-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      const body = (await response.json()) as LoadResponse;
      if (!response.ok || !body.payload) {
        throw new Error(body.error || "Could not read session.json.");
      }
      setPayload(body.payload);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payload) {
      setError("Load a session directory before creating the session.");
      return;
    }

    setError(null);
    setIsCreating(true);
    try {
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
              register research session
            </h2>
          </div>
          <button type="button" className="btn btn-quiet icon-btn" onClick={onClose}>
            <X size={15} />
            <span className="sr-only">close</span>
          </button>
        </div>

        <div className="modal-body new-session-body">
          <label className="field">
            <span className="field-label">session folder</span>
            <span className="path-row">
              <input
                className="input path-input"
                value={sessionDir}
                onChange={(event) => {
                  setSessionDir(event.target.value);
                  setPayload(null);
                }}
                placeholder="/absolute/path/to/session-dir"
              />
              <button
                type="button"
                className="btn"
                onClick={pickSessionDirectory}
                disabled={isPicking || isLoading || isCreating}
              >
                {isPicking ? <Loader2 size={13} className="spin" /> : <FolderOpen size={13} />}
                browse
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void loadSessionDirectory()}
                disabled={isPicking || isLoading || isCreating}
              >
                {isLoading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                load
              </button>
            </span>
          </label>

          {payload ? <ContractPreview payload={payload} /> : <EmptyContractPreview />}

          {error ? <div className="form-error">{error}</div> : null}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!payload || isCreating}>
            {isCreating ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
            register session
          </button>
        </div>
      </form>
    </div>
  );
}

function ContractPreview({ payload }: { payload: NewSessionPayload }) {
  const objective = objectiveSummary(payload.metricContract);
  const metricCount = payload.metricContract.metrics?.length ?? 0;

  return (
    <section className="contract-preview" aria-label="Loaded session contract">
      <div className="contract-head">
        <FileJson size={15} />
        <span>session.json</span>
        <span className="contract-status">loaded</span>
      </div>

      <div className="contract-grid">
        <ContractItem label="title" value={payload.title} />
        <ContractItem label="slug" value={payload.slug} />
        <ContractItem label="repo path" value={payload.repoPath} wide />
        <ContractItem label="benchmark" value={payload.benchmarkCommand} wide />
        <ContractItem label="base ref" value={payload.baseRef || "HEAD"} />
        <ContractItem label="compute budget" value={formatComputeBudget(payload.computeBudget)} />
        <ContractItem
          label="experiments"
          value={`${payload.targetExperimentCount} target · ${payload.maxConcurrentRuns} runner${
            payload.maxConcurrentRuns === 1 ? "" : "s"
          } · ${payload.maxPlannedConcurrentExperiments ?? 3} max plan · ${
            payload.preemptivePlanning === false ? "serial planning" : "preemptive planning"
          }`}
        />
        <ContractItem label="sandbox" value={formatSandboxEnvironment(payload.sandbox)} />
        <ContractItem
          label="objective"
          value={`${objective.name || "unspecified"} · ${objective.direction || "unknown"}`}
        />
        <ContractItem
          label="metrics"
          value={`${metricCount || 1} metric${metricCount === 1 ? "" : "s"} · ${
            payload.metricContract.rankingMode || "primary"
          }`}
        />
        <ContractList label="editable paths" values={payload.editablePaths} />
        <ContractList label="immutable paths" values={payload.immutablePaths} />
        <ContractList
          label="runtime config paths"
          values={payload.runtimeConfigPaths ?? []}
        />
        <ContractList
          label="artifacts"
          values={(payload.artifactContract?.artifacts ?? []).map((artifact) => artifact.path)}
        />
        <ContractItem
          label="model io contract"
          value={payload.modelIoContract || "not declared"}
          wide
        />
      </div>
    </section>
  );
}

function EmptyContractPreview() {
  return (
    <div className="contract-empty">
      <FileJson size={16} />
      <span>no session.json loaded</span>
    </div>
  );
}

function ContractItem({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`contract-item ${wide ? "wide" : ""}`}>
      <span className="field-label">{label}</span>
      <span className="contract-value">{value}</span>
    </div>
  );
}

function ContractList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="contract-item">
      <span className="field-label">{label}</span>
      {values.length > 0 ? (
        <span className="contract-list">
          {values.map((value) => (
            <code key={value}>{value}</code>
          ))}
        </span>
      ) : (
        <span className="contract-value muted">none</span>
      )}
    </div>
  );
}

function objectiveSummary(metricContract: NewSessionPayload["metricContract"]) {
  const primaryMetric = metricContract.primaryMetric;
  const topObjective = metricContract.metrics?.find(
    (metric) => String(metric.role ?? "objective") !== "constraint",
  );
  const primarySpec = metricContract.metrics?.find(
    (metric) => metric.name === primaryMetric,
  );

  return {
    name: primaryMetric || topObjective?.name || metricContract.metrics?.[0]?.name,
    direction:
      metricContract.direction ||
      primarySpec?.direction ||
      topObjective?.direction ||
      metricContract.metrics?.[0]?.direction,
  };
}

function formatComputeBudget(value: NewSessionPayload["computeBudget"]) {
  const seconds =
    typeof value === "object" && value !== null
      ? Number(value.seconds ?? 300)
      : value === undefined || value === null || value === ""
        ? 300
        : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "5 min";
  }
  if (seconds % 3600 === 0) {
    return `${seconds / 3600} hr`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }
  return `${seconds}s`;
}

function formatSandboxEnvironment(value: NewSessionPayload["sandbox"]) {
  if (typeof value === "string") {
    return normalizeSandboxLabel(value);
  }
  return normalizeSandboxLabel(
    value?.environment ?? value?.provider ?? value?.backend ?? "none",
  );
}

function normalizeSandboxLabel(value: unknown) {
  const environment = String(value ?? "none").trim().toLowerCase();
  if (environment === "local" || environment === "direct") return "none";
  if (environment === "sandcastle") return "docker";
  return environment || "none";
}
