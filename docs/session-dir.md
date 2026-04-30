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
  "agent": {
    "provider": "codex",
    "model": "gpt-5.4",
    "effort": "high"
  },
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
