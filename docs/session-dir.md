# Session Directory Contract

A session directory is the handoff between a target project and Autoresearch. It
can live anywhere on disk and should be small enough to check into the target
project or keep beside it. The only file the CLI requires today is
`session.json`.

For a project-local scaffold, run this from the target repository root:

```bash
autoresearch init
```

That creates `.autoresearch/` with setup docs for users and agents, plus a
reference session under `.autoresearch/sessions/example`. For real campaigns,
copy the example to `.autoresearch/sessions/<slug>` and edit the copied
contract. From that location, `repoPath` usually points back to the repository
root with `../../..`.

```text
my-session/
  session.json                  # required machine-readable contract
  goal.md                       # recommended objective and scope
  metric_contract.md            # recommended metric/output notes
  prompts/                      # optional prompt source material
    planner.md
    reviewer.md
    worker.md
  context/                      # optional domain notes for humans/agents
    domain.md
    constraints.md
  baselines/                    # optional evidence from known-good runs
    baseline.metrics.json
    baseline.log
  references/                   # optional paper notes, diagrams, examples
  .env.example                  # optional variable names, never secrets
```

Keep the target repository itself outside the session directory. `repoPath` in
`session.json` points at that repository. Runner-created workspaces are separate
disposable copies or git worktrees under the runner workspace root, which
defaults to `~/.autoresearch/runner`; they are not part of the session directory
contract.

`goal.md`, `metric_contract.md`, prompts, context notes, baselines, and
references are optional for the current runtime. Treat them as stable source
material for reviewers, prompt authors, and future tooling. Do not store secret
values in any session file; use `agent.envVars`, `sandbox.envVars`, or a local
environment instead.

## Folder Roles

- `session.json`: the single source of truth for registration and execution.
- `goal.md`: concise objective, out-of-scope changes, and success criteria.
- `metric_contract.md`: how the benchmark reports metrics, the objective
  priority order, and what makes a run valid.
- `prompts/`: reusable prompt fragments or full planner/reviewer/worker prompts.
  The current CLI does not load these automatically.
- `context/`: domain vocabulary, model assumptions, dataset constraints, or
  architecture notes that should not live in `session.json`.
- `baselines/`: optional benchmark logs or metric snapshots from the unmodified
  target project. These are for comparison and audit, not runtime input.
- `references/`: optional supporting materials such as paper notes, screenshots,
  or diagrams.
- `.env.example`: names of required environment variables only.

## `session.json`

```json
{
  "slug": "my-model-search",
  "title": "My model search",
  "repoPath": "../target-project",
  "baseRef": "HEAD",
  "benchmarkCommand": "npm test -- --json",
  "computeBudget": { "seconds": 300 },
  "targetExperimentCount": 20,
  "maxConcurrentRuns": 2,
  "maxPlannedConcurrentExperiments": 3,
  "editablePaths": ["src/model.ts", "config/tunable.json", "figures/model_architecture.tex"],
  "immutablePaths": ["data/**", "config/fixed.json", "figures/**/*.pdf", "figures/**/*.png"],
  "runtimeConfigPaths": ["config/tunable.json"],
  "workspaceLinks": [
    {
      "workspacePath": "prepared/large_readonly_dataset.pt",
      "targetPath": "/absolute/path/to/shared/large_readonly_dataset.pt"
    }
  ],
  "modelIoContract": "Keep the public CLI and metric JSON output stable. For architecture_change experiments, update figures/model_architecture.tex using TikZ.",
  "agent": {
    "provider": "codex",
    "model": "gpt-5.4",
    "effort": "high",
    "researcher": { "model": "gpt-5.4", "effort": "high" },
    "planner": { "model": "gpt-5.4", "effort": "high" },
    "reviewer": { "model": "gpt-5.4", "effort": "high" },
    "worker": { "model": "gpt-5.4", "effort": "high" },
    "memoryKeeper": { "model": "gpt-5.4", "effort": "high" }
  },
  "memory": {
    "enabled": true,
    "rootPath": "research",
    "referencePaths": ["references"]
  },
  "sandbox": {
    "environment": "none"
  },
  "earlyStopping": {
    "enabled": true,
    "maxPlanningCyclesWithoutAcceptedExperiments": 3
  },
  "metricContract": {
    "rankingMode": "lexicographic",
    "metrics": [
      { "name": "validation_loss", "direction": "minimize", "role": "objective" },
      { "name": "accuracy", "direction": "maximize", "role": "objective" },
      { "name": "latency_ms", "direction": "minimize", "role": "constraint", "max": 25 }
    ]
  }
}
```

For `rankingMode: "lexicographic"`, objective metrics are compared in list
order. Constraint metrics are pass/fail gates and are not used as tie-breakers.
Registration derives compatibility fields from the first objective metric.

Paths in `repoPath` are resolved relative to the session directory at
registration time and stored as absolute paths. `editablePaths`,
`immutablePaths`, and `runtimeConfigPaths` are always relative to the target
repository root.

The benchmark command runs inside an isolated copy or git worktree of the target
repository. The runner accepts metrics from the last JSON object printed by the
benchmark or from lines shaped like `metric_name: 1.23`.

`computeBudget.seconds` is the benchmark wall-clock budget for each run. It
defaults to 300 seconds when omitted. Registration also accepts shorthand
duration values such as `"computeBudget": "5m"` or `"computeBudget": 300`, but
stores the normalized object form. The runner also exposes the value to the
benchmark process as `AUTORESEARCH_COMPUTE_BUDGET_SECONDS`.

`maxPlannedConcurrentExperiments` controls how many independent experiments the
planner may propose in a single planning cycle. It defaults to 3 and is capped by
the remaining target experiment count.

`earlyStopping.maxPlanningCyclesWithoutAcceptedExperiments` pauses the session
after that many consecutive completed planning cycles approve zero experiments.
Set `earlyStopping.enabled: true` to activate it. This is useful when the
researcher, planner, and reviewer have exhausted viable ideas and continued
planning would only burn agent time.

`workspaceLinks` is important for long sessions. It creates explicit symlinks
inside every runner workspace after checkout and before the worker or benchmark
runs. Use it for large read-only generated inputs that should be shared across
runs, such as prepared datasets, cached features, or tensor bundles. Without it,
each run can leave another copy under `~/.autoresearch/runner/<session>/<run>/`.
`workspacePath` is relative to the runner workspace; if the fresh checkout
already contains that path, the runner replaces it with the configured symlink
before applying patches or starting the worker. `targetPath` is resolved at
registration time and must exist on the runner host. Pair linked paths with
`immutablePaths` so workers know they must read them but not modify them.

## Durable Research Memory

Researcher and memory-keeper roles default to enabled. Add a `memory` block to
customize their paths or disable individual roles:

```json
{
  "memory": {
    "enabled": true,
    "rootPath": "research",
    "notesPath": "research/notes.md",
    "doNotRepeatPath": "research/do-not-repeat.md",
    "paperIdeasPath": "research/paper-ideas.md",
    "campaignsPath": "research/campaigns",
    "experimentsPath": "research/experiments",
    "templatesPath": "research/templates",
    "referencePaths": ["references", "docs/papers"],
    "researcher": { "enabled": true },
    "memoryKeeper": { "enabled": true }
  }
}
```

All `memory` paths are relative to `repoPath`, not the session directory. When a
planning cycle starts, the orchestrator optionally runs a researcher before the
planner. The researcher reads the configured memory and reference paths, rejects
duplicates and stale ideas, and emits candidate single-change hypotheses for the
planner and reviewer.

After a run completes or fails inside the runner, the memory keeper optionally
updates the configured memory files in the target repo. It is prompted to edit
only the memory paths, preserve the hypothesis, base reference, metrics or
failure state, current-best decision, and a short interpretation, and turn
regressions or invalid runs into concise do-not-repeat guidance.

If `memory` is omitted, the default memory paths under `research/` are used and
both roles are enabled. Set `memory.enabled: false` to skip both roles, or
disable individual roles with `memory.researcher.enabled: false` or
`memory.memoryKeeper.enabled: false`.

## TikZ Architecture Artifacts

When architecture changes should be visible as diagrams, add a standalone TikZ
source path or glob to `editablePaths`, usually `figures/**/*.tex`. The source
file can be absent at session start; architecture-change workers must create it
or update it as part of the same change. Keep rendered PDF and PNG outputs in
`immutablePaths`; workers edit only the `.tex` diagram source and do not render
diagram files themselves.

For accepted patches, the runner detects changed TikZ `.tex` sources, compiles a
temporary PDF, converts it to PNG, and stores only the PNG bytes in
`researchArtifacts`. This happens locally after the patch is accepted. The PDF
is not persisted.

Architecture experiments are required to create or update an editable TikZ
source. Worker prompts directly invoke `$model-diagram-tikz` and use the
repo-local skill at `.agents/skills/model-diagram-tikz/SKILL.md` for diagram
style and validation.

Check the local toolchain with:

```bash
autoresearch doctor
```

On macOS, install BasicTeX and the required packages with:

```bash
autoresearch install-tex --macos
```

## Agent Provider

The orchestrator and runner use Sandcastle's agent provider interface. The
orchestrator roles are `researcher`, `planner`, and `reviewer`; the runner roles
are `worker` and `memoryKeeper`. `agent.provider` may be `codex`, `claude-code`,
`opencode`, or `pi`.

```json
{
  "agent": {
    "provider": "claude-code",
    "model": "claude-sonnet-4-6",
    "effort": "high",
    "envVars": ["ANTHROPIC_API_KEY"],
    "planner": {
      "provider": "codex",
      "model": "gpt-5.4",
      "effort": "high",
      "envVars": ["OPENAI_API_KEY"]
    },
    "reviewer": {
      "provider": "claude-code",
      "model": "claude-sonnet-4-6"
    },
    "worker": {
      "provider": "codex",
      "model": "gpt-5.4"
    },
    "memoryKeeper": {
      "provider": "claude-code",
      "model": "claude-sonnet-4-6"
    }
  }
}
```

Top-level `agent` fields are defaults for every role. `agent.<role>` overrides
the default for that role. When omitted, every role defaults to Codex with
`gpt-5.4`. `envVars` passes named variables from the local orchestrator or runner
process into the agent command. Do not put secret values directly in
`session.json`, because the session contract is stored in Convex.

Role-specific CLI and environment overrides are also supported. For example,
`--planner-agent-provider`, `--planner-agent-model`,
`AUTORESEARCH_PLANNER_AGENT_PROVIDER`, and
`AUTORESEARCH_PLANNER_AGENT_MODEL` override only the planner. Global overrides
such as `--agent-provider`, `--agent-model`, `AUTORESEARCH_AGENT_PROVIDER`, and
`AUTORESEARCH_AGENT_MODEL` apply to all roles in that process.

## Optional Sandcastle Runtime

By default the local runner creates a disposable workspace and runs the selected
agent directly on the host. Configure `sandbox.environment` to choose where the
agent and benchmark execute:

- `none`: run locally on the host.
- `docker`: run through Sandcastle using Docker.
- `podman`: run through Sandcastle using Podman.
- `vercel`: run through Sandcastle using Vercel Firecracker microVMs.

```json
{
  "sandbox": {
    "environment": "docker",
    "imageName": "sandcastle:target-project",
    "setupCommand": "npm ci",
    "envVars": ["OPENAI_API_KEY"],
    "mounts": [
      {
        "hostPath": "~/.npm",
        "sandboxPath": "~/.npm"
      }
    ]
  }
}
```

For Docker and Podman, `imageName` should point at a local image that contains
the project runtime plus the selected agent CLI. `setupCommand` or
`setupCommands` run inside each sandbox before the agent or benchmark command.
Use `sandbox.envVars` only for variables needed by setup or benchmark commands;
agent credentials usually belong in `agent.envVars`. Vercel environments accept
Sandcastle's Vercel options such as `runtime`, `projectId`, `teamId`, `token`,
`resources`, and `timeoutMs`.

You can also force the sandbox environment for a runner process without changing
a session:

```bash
AUTORESEARCH_SANDBOX_ENVIRONMENT=docker autoresearch runner --once
```

See `examples/basic-session/session.sandcastle.json` for a complete sample
contract.

## Register

Start the local stack:

```bash
autoresearch run
```

Initialize project-local session docs and a reference session:

```bash
autoresearch init
```

Print exact setup guidance and a starter contract for a session folder:

```bash
autoresearch session guide /path/to/my-session --repo-path /path/to/target-project
```

Register a session from any directory:

```bash
autoresearch session add /path/to/my-session
```

Start the local stack without adding a session:

```bash
autoresearch run
```

`autoresearch run` starts the local Convex backend, serves the production
frontend preview, and supervises orchestrator and runner workers. Add sessions
from the UI or with `autoresearch session add` after the stack is available.
For frontend development, use `autoresearch dev`.

Restart a stack that was started with `autoresearch run`:

```bash
autoresearch restart
```

`autoresearch restart` stops the existing run stack, then starts a fresh
production frontend preview stack in the current terminal.

If the stack is not using the default `.env.local`, pass the Convex URL:

```bash
autoresearch run --convex-url http://127.0.0.1:3210
```

When adding a session to an existing non-default backend, pass the same Convex
URL:

```bash
autoresearch session add /path/to/my-session --convex-url http://127.0.0.1:3210
```

Validate the resolved payload without contacting Convex:

```bash
autoresearch session add /path/to/my-session --dry-run
```
