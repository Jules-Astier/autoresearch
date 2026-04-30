# Session Directory Contract

A session directory is the handoff between a project and Autoresearch. It can
live anywhere on disk. The only required file is `session.json`.

```text
my-session/
  session.json
  goal.md
  metric_contract.md
  prompts/
```

`goal.md`, `metric_contract.md`, and prompt files are optional for the runtime,
but useful context for humans and for prompts referenced in `session.json`.

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
  "editablePaths": ["src/model.ts", "config/tunable.json"],
  "immutablePaths": ["data/**", "config/fixed.json"],
  "runtimeConfigPaths": ["config/tunable.json"],
  "modelIoContract": "Keep the public CLI and metric JSON output stable.",
  "metricContract": {
    "primaryMetric": "validation_loss",
    "direction": "minimize",
    "metrics": [
      { "name": "validation_loss", "direction": "minimize" },
      { "name": "accuracy", "direction": "maximize" }
    ]
  }
}
```

Paths in `repoPath` are resolved relative to the session directory at
registration time and stored as absolute paths. `editablePaths`,
`immutablePaths`, and `runtimeConfigPaths` are always relative to the target
repository root.

The benchmark command runs inside an isolated copy or git worktree of the target
repository. The runner accepts metrics from the last JSON object printed by the
benchmark or from lines shaped like `metric_name: 1.23`.

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
