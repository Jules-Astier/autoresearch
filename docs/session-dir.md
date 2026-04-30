# Session Directory Contract

A session directory is the handoff between a target project and Autoresearch. It
can live anywhere on disk and should be small enough to check into the target
project or keep beside it. The only file the CLI requires today is
`session.json`.

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
disposable copies or git worktrees under the runner workspace root; they are not
part of the session directory contract.

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
  "targetExperimentCount": 20,
  "maxConcurrentRuns": 2,
  "editablePaths": ["src/model.ts", "config/tunable.json", "figures/model_architecture.tex"],
  "immutablePaths": ["data/**", "config/fixed.json", "figures/**/*.pdf", "figures/**/*.png"],
  "runtimeConfigPaths": ["config/tunable.json"],
  "modelIoContract": "Keep the public CLI and metric JSON output stable. For architecture_change experiments, update figures/model_architecture.tex using TikZ.",
  "agent": {
    "provider": "codex",
    "model": "gpt-5.4",
    "effort": "high"
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

## TikZ Architecture Artifacts

When architecture changes should be visible as diagrams, add a standalone TikZ
source file to `editablePaths`, usually under `figures/`. Keep rendered PDF and
PNG outputs in `immutablePaths`; workers should edit only the `.tex` source.

For accepted patches, the runner detects changed TikZ `.tex` sources, compiles a
temporary PDF, converts it to PNG, and stores only the PNG bytes in
`researchArtifacts`. The PDF is not persisted.

Architecture experiments are required to update a TikZ source when the session
has an editable diagram path. Use the repo-local skill at
`.agents/skills/model-diagram-tikz/SKILL.md` for diagram style and validation.

Check the local toolchain with:

```bash
autoresearch doctor
```

On macOS, install BasicTeX and the required packages with:

```bash
autoresearch install-tex --macos
```

## Agent Provider

The local runner uses Sandcastle's agent provider interface for host-direct and
Sandcastle-backed execution. `agent.provider` may be `codex`, `claude-code`,
`opencode`, or `pi`.

```json
{
  "agent": {
    "provider": "claude-code",
    "model": "claude-sonnet-4-6",
    "effort": "high",
    "envVars": ["ANTHROPIC_API_KEY"]
  }
}
```

When omitted, the runner defaults to Codex with `gpt-5.4`. `envVars` passes
named variables from the runner process into the agent command. Do not put secret
values directly in `session.json`, because the session contract is stored in
Convex.

## Optional Sandcastle Runtime

By default the local runner creates a disposable workspace and runs the selected
agent directly on the host. A session can opt into Sandcastle-backed execution
for the agent and benchmark by adding a `sandbox` block:

```json
{
  "sandbox": {
    "backend": "sandcastle",
    "provider": "docker",
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

`provider` may be `docker` or `podman`. `imageName` should point at a local image
that contains the project runtime plus the selected agent CLI. `setupCommand` or
`setupCommands` run inside each sandbox before the agent or benchmark command.
Use `sandbox.envVars` only for variables needed by setup or benchmark commands;
agent credentials usually belong in `agent.envVars`.

You can also force the backend for a runner process without changing a session:

```bash
AUTORESEARCH_RUNNER_BACKEND=sandcastle autoresearch runner --once
```

See `examples/basic-session/session.sandcastle.json` for a complete sample
contract.

## Register

Start the local stack:

```bash
autoresearch dev
```

Register a session from any directory:

```bash
autoresearch register /path/to/my-session
```

If the stack is not using the default `.env.local`, pass the Convex URL:

```bash
autoresearch register /path/to/my-session --convex-url http://127.0.0.1:3210
```

Validate the resolved payload without contacting Convex:

```bash
autoresearch register /path/to/my-session --dry-run
```
