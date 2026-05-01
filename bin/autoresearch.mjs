#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_COMPUTE_BUDGET_SECONDS = 300;
const AGENT_ROLE_CONFIG_KEYS = ["researcher", "planner", "reviewer", "worker", "memoryKeeper"];

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "init") {
    initProject(argv);
    return;
  }
  if (command === "dev" || command === "start") {
    await runScript("dev-stack.mjs", argv);
    return;
  }
  if (command === "session" || command === "sessions") {
    await runSessionCommand(argv);
    return;
  }
  if (command === "session-guide" || command === "guide-session") {
    printSessionGuide(argv);
    return;
  }
  if (command === "register" || command === "add" || command === "add-session") {
    await registerSession(argv);
    return;
  }
  if (command === "doctor") {
    runDoctor();
    return;
  }
  if (command === "install-tex") {
    await installTex(argv);
    return;
  }
  if (command === "runner") {
    await runScript("codex-runner.mjs", argv);
    return;
  }
  if (command === "orchestrator") {
    await runScript("codex-orchestrator.mjs", argv);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function initProject(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    printInitHelp();
    return;
  }
  if (args._.length > 1) {
    throw new Error("Usage: autoresearch init [project-dir] [--force]");
  }

  const projectDir = path.resolve(process.cwd(), args._[0] ?? ".");
  const projectStat = fs.existsSync(projectDir) ? fs.statSync(projectDir) : undefined;
  if (!projectStat?.isDirectory()) {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }

  const autoresearchDir = path.join(projectDir, ".autoresearch");
  const projectName = slugify(path.basename(projectDir));
  const exampleSessionDir = path.join(autoresearchDir, "sessions", "example");
  const exampleRepoPath = normalizePathForJson(path.relative(exampleSessionDir, projectDir) || ".");
  const force = Boolean(args.force);
  const writes = [
    ["README.md", initReadmeContent(projectName)],
    ["AGENTS.md", initAgentsContent()],
    ["sessions/README.md", initSessionsReadmeContent()],
    [
      "sessions/example/session.json",
      `${JSON.stringify(exampleSessionContract(projectName, exampleRepoPath), null, 2)}\n`
    ],
    ["sessions/example/goal.md", exampleGoalContent()],
    ["sessions/example/metric_contract.md", exampleMetricContractContent()],
    ["sessions/example/context/domain.md", exampleDomainContent()],
    ["sessions/example/prompts/planner.md", examplePlannerPromptContent()],
    ["sessions/example/prompts/reviewer.md", exampleReviewerPromptContent()],
    ["sessions/example/prompts/worker.md", exampleWorkerPromptContent()],
    ["sessions/example/baselines/README.md", exampleBaselinesReadmeContent()],
    ["sessions/example/references/README.md", exampleReferencesReadmeContent()],
    ["sessions/example/.env.example", exampleEnvContent()]
  ];

  const results = writes.map(([relativePath, content]) =>
    writeInitFile(autoresearchDir, relativePath, content, { force })
  );
  const created = results.filter((result) => result.status === "created");
  const updated = results.filter((result) => result.status === "updated");
  const skipped = results.filter((result) => result.status === "skipped");

  console.log(`Initialized Autoresearch project files at ${autoresearchDir}`);
  printInitResultGroup("Created", created);
  printInitResultGroup("Updated", updated);
  printInitResultGroup("Skipped existing", skipped);
  if (skipped.length > 0 && !force) {
    console.log("");
    console.log("Use `autoresearch init --force` to rewrite the scaffolded files.");
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. Copy .autoresearch/sessions/example to .autoresearch/sessions/<slug>.");
  console.log("  2. Edit that session.json, goal.md, and metric_contract.md for this project.");
  console.log("  3. Validate with `autoresearch session add .autoresearch/sessions/<slug> --dry-run`.");
}

function writeInitFile(rootDir, relativePath, content, { force }) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (fs.existsSync(absolutePath) && !force) {
    return { relativePath, status: "skipped" };
  }
  const status = fs.existsSync(absolutePath) ? "updated" : "created";
  fs.writeFileSync(absolutePath, content, "utf8");
  return { relativePath, status };
}

function printInitResultGroup(label, results) {
  if (results.length === 0) return;
  console.log(`${label}:`);
  for (const result of results) {
    console.log(`  .autoresearch/${result.relativePath}`);
  }
}

function initReadmeContent(projectName) {
  const title = titleFromSlug(projectName);
  return textBlock([
    "# Autoresearch",
    "",
    `This folder contains Autoresearch session setup for ${title}. Keep one session directory per research campaign under \`sessions/\`.`,
    "",
    "## Layout",
    "",
    "- `AGENTS.md`: operating rules for AI agents that create or update sessions.",
    "- `sessions/`: project-local session directories.",
    "- `sessions/example/`: reference session. Copy it before registering a real session.",
    "",
    "## Session Setup",
    "",
    "1. Copy `sessions/example` to `sessions/<slug>`.",
    "2. Edit `sessions/<slug>/session.json` so `benchmarkCommand`, path globs, budgets, agent settings, and metric names match this repository.",
    "3. Replace `goal.md` with the session objective, out-of-scope changes, and success criteria.",
    "4. Replace `metric_contract.md` with the exact benchmark output contract and objective priority.",
    "5. Add notes under `context/`, `references/`, or `baselines/` only when they help agents make better bounded changes.",
    "6. Validate without contacting Convex:",
    "",
    "```bash",
    "autoresearch session add .autoresearch/sessions/<slug> --dry-run",
    "```",
    "",
    "7. Start the local stack and register the session:",
    "",
    "```bash",
    "autoresearch dev",
    "autoresearch session add .autoresearch/sessions/<slug>",
    "```",
    "",
    "## Checklist",
    "",
    "- `repoPath` points from the session directory back to this repository. For `sessions/<slug>`, that is usually `../../..`.",
    "- `editablePaths`, `immutablePaths`, and `runtimeConfigPaths` are relative to the repository root, not the session directory.",
    "- `metricContract.metrics` is ordered by priority when `rankingMode` is `lexicographic`.",
    "- Secrets stay out of session files. Put only environment variable names in `agent.envVars`, `sandbox.envVars`, or `.env.example`.",
    "- The benchmark must print either a final JSON object or `metric_name: 1.23` lines."
  ]);
}

function initAgentsContent() {
  return textBlock([
    "# Autoresearch Agent Instructions",
    "",
    "Use these rules when creating or updating sessions in this project.",
    "",
    "- Create new sessions under `.autoresearch/sessions/<slug>`.",
    "- Treat `.autoresearch/sessions/example` as reference material unless the user asks you to change the scaffold.",
    "- Keep `session.json` valid JSON. Do not add comments or trailing commas.",
    "- Keep `repoPath` relative from the session directory to the repository root when possible. For `.autoresearch/sessions/<slug>`, use `../../..`.",
    "- Use repository-relative globs for `editablePaths`, `immutablePaths`, and `runtimeConfigPaths`.",
    "- Do not put secrets, credentials, tokens, or host-specific absolute paths in committed session files.",
    "- Update `goal.md` and `metric_contract.md` whenever the session contract changes.",
    "- Do not invent benchmark metrics. If the benchmark output is unknown, document the blocker in `metric_contract.md`.",
    "- Before registration, run `autoresearch session add .autoresearch/sessions/<slug> --dry-run` and fix contract errors."
  ]);
}

function initSessionsReadmeContent() {
  return textBlock([
    "# Sessions",
    "",
    "Each child directory is an Autoresearch session directory. A real session should include at least:",
    "",
    "```text",
    "session.json",
    "goal.md",
    "metric_contract.md",
    "context/",
    "prompts/",
    "baselines/",
    "references/",
    ".env.example",
    "```",
    "",
    "`session.json` is the machine-readable contract. The Markdown files are stable context for users, agents, and future tooling."
  ]);
}

function exampleSessionContract(projectName, repoPath) {
  return {
    slug: `${projectName}-example`,
    title: `${titleFromSlug(projectName)} example session`,
    repoPath,
    baseRef: "HEAD",
    benchmarkCommand: "npm test -- --json",
    computeBudget: { seconds: DEFAULT_COMPUTE_BUDGET_SECONDS },
    targetExperimentCount: 10,
    maxConcurrentRuns: 1,
    maxPlannedConcurrentExperiments: 3,
    editablePaths: ["src/**", "config/**"],
    immutablePaths: ["data/**", "package-lock.json"],
    runtimeConfigPaths: ["package.json", "config/**"],
    modelIoContract: "Preserve public inputs, outputs, benchmark command, and metric JSON shape.",
    agent: {
      provider: "codex",
      model: "gpt-5.4",
      effort: "high",
      researcher: { model: "gpt-5.4", effort: "high" },
      planner: { model: "gpt-5.4", effort: "high" },
      reviewer: { model: "gpt-5.4", effort: "high" },
      worker: { model: "gpt-5.4", effort: "high" },
      memoryKeeper: { model: "gpt-5.4", effort: "high" }
    },
    memory: {
      enabled: true,
      rootPath: "research",
      referencePaths: ["references"]
    },
    sandbox: {
      environment: "none"
    },
    metricContract: {
      rankingMode: "lexicographic",
      metrics: [
        { name: "validation_loss", direction: "minimize", role: "objective" },
        { name: "accuracy", direction: "maximize", role: "objective" },
        { name: "latency_ms", direction: "minimize", role: "constraint", max: 1000 }
      ]
    }
  };
}

function exampleGoalContent() {
  return textBlock([
    "# Goal",
    "",
    "Improve the target project's ordered validation objectives by changing only the declared editable paths.",
    "",
    "## Success Criteria",
    "",
    "- The benchmark finishes successfully.",
    "- Objective metrics improve in the priority order declared in `metric_contract.md`.",
    "- Public inputs, outputs, and metric output shape remain compatible.",
    "",
    "## Out Of Scope",
    "",
    "- Changing datasets, data splits, or objective definitions.",
    "- Changing benchmark commands or metric parsing.",
    "- Changing credentials, deployment behavior, or unrelated product code."
  ]);
}

function exampleMetricContractContent() {
  return textBlock([
    "# Metric Contract",
    "",
    "The benchmark must print a final JSON object or parseable metric lines.",
    "",
    "Objective priority:",
    "",
    "1. `validation_loss` minimize",
    "2. `accuracy` maximize",
    "",
    "Constraints:",
    "",
    "- `latency_ms` must be at most `1000`.",
    "",
    "A valid run must exit successfully and include numeric values for all required metrics."
  ]);
}

function exampleDomainContent() {
  return textBlock([
    "# Domain Notes",
    "",
    "Replace this file with project vocabulary, architecture constraints, dataset notes, and assumptions agents should preserve.",
    "",
    "Good context is specific and stable:",
    "",
    "- What the benchmark measures.",
    "- Which files define tunable behavior.",
    "- Which interfaces must remain unchanged.",
    "- Known failure modes or duplicate ideas to avoid."
  ]);
}

function examplePlannerPromptContent() {
  return textBlock([
    "# Planner Notes",
    "",
    "Use this file for reusable planning guidance that should stay with the session.",
    "",
    "- Propose single-change experiments.",
    "- Respect `editablePaths` and `immutablePaths`.",
    "- Tie each hypothesis to a measurable metric from `metric_contract.md`."
  ]);
}

function exampleReviewerPromptContent() {
  return textBlock([
    "# Reviewer Notes",
    "",
    "Use this file for review criteria that should stay with the session.",
    "",
    "- Reject changes that modify immutable surfaces.",
    "- Reject hypotheses without measurable outcomes.",
    "- Prefer bounded experiments over broad refactors."
  ]);
}

function exampleWorkerPromptContent() {
  return textBlock([
    "# Worker Notes",
    "",
    "Use this file for implementation constraints that should stay with the session.",
    "",
    "- Make the smallest code change that tests the assigned hypothesis.",
    "- Keep benchmark output parseable.",
    "- Do not edit data, credentials, or session files during a run."
  ]);
}

function exampleBaselinesReadmeContent() {
  return textBlock([
    "# Baselines",
    "",
    "Store optional known-good benchmark logs or metric snapshots here. Do not store large datasets or generated runner workspaces."
  ]);
}

function exampleReferencesReadmeContent() {
  return textBlock([
    "# References",
    "",
    "Store optional paper notes, design notes, screenshots, or links that help agents reason about this session."
  ]);
}

function exampleEnvContent() {
  return textBlock([
    "# Optional variable names for this session. Do not put real secret values here.",
    "# OPENAI_API_KEY=",
    "# ANTHROPIC_API_KEY="
  ]);
}

function textBlock(lines) {
  return `${lines.join("\n")}\n`;
}

async function runSessionCommand(argv) {
  const [subcommand, ...subargv] = argv;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printSessionHelp();
    return;
  }
  if (subcommand === "guide" || subcommand === "setup" || subcommand === "configure") {
    printSessionGuide(subargv);
    return;
  }
  if (subcommand === "add" || subcommand === "register") {
    await registerSession(subargv);
    return;
  }
  throw new Error(`Unknown session command: ${subcommand}`);
}

async function registerSession(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    printSessionAddHelp();
    return;
  }
  const sessionDirArg = args._[0];
  if (!sessionDirArg) {
    throw new Error("Usage: autoresearch session add <session-dir> [--convex-url URL] [--dry-run]");
  }
  if (args._.length > 1) {
    throw new Error("Usage: autoresearch session add <session-dir> [--convex-url URL] [--dry-run]");
  }
  const sessionDir = path.resolve(process.cwd(), sessionDirArg);
  const contractPath = path.join(sessionDir, "session.json");
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Missing session.json: ${contractPath}`);
  }

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const payload = normalizeSessionContract(contract, sessionDir);
  if (args.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const convexUrl = args.convexUrl ?? process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? loadEnvFile(path.join(ROOT, ".env.local")).VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing Convex URL. Run `autoresearch dev` or pass --convex-url.");
  }

  const client = new ConvexHttpClient(convexUrl);
  const sessionId = await client.mutation(api.orchestration.registerResearchSession, payload);
  console.log(`Registered ${payload.slug} at ${convexUrl}`);
  console.log(`Session id: ${sessionId}`);
}

function printSessionGuide(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    printSessionGuideHelp();
    return;
  }
  if (args._.length > 1) {
    throw new Error("Usage: autoresearch session guide [session-dir] [guide options]");
  }

  const sessionDir = path.resolve(process.cwd(), args._[0] ?? "my-session");
  const repoPath = sessionGuideRepoPath(args, sessionDir);
  const slug = stringArg(args, "slug", slugify(path.basename(sessionDir)));
  const title = stringArg(args, "title", titleFromSlug(slug));
  const benchmarkCommand = stringArg(args, "benchmarkCommand", "npm test -- --json");
  const computeBudgetSeconds = positiveIntegerArg(
    args,
    "computeBudgetSeconds",
    DEFAULT_COMPUTE_BUDGET_SECONDS
  );
  const metric = stringArg(args, "metric", "validation_loss");
  const direction = metricDirectionArg(args, "direction", "minimize");
  const contract = {
    slug,
    title,
    repoPath,
    baseRef: "HEAD",
    benchmarkCommand,
    computeBudget: {
      seconds: computeBudgetSeconds
    },
    targetExperimentCount: positiveIntegerArg(args, "targetExperimentCount", 10),
    maxConcurrentRuns: nonNegativeIntegerArg(args, "maxConcurrentRuns", 1),
    maxPlannedConcurrentExperiments: positiveIntegerArg(args, "maxPlannedConcurrentExperiments", 3),
    editablePaths: csvArg(args, "editablePaths", ["src/**", "config/**", "figures/**/*.tex"]),
    immutablePaths: csvArg(args, "immutablePaths", ["data/**", "figures/**/*.pdf", "figures/**/*.png"]),
    runtimeConfigPaths: csvArg(args, "runtimeConfigPaths", ["config/**"]),
    modelIoContract: "Preserve public inputs, outputs, and metric JSON shape.",
    agent: {
      provider: stringArg(args, "agentProvider", "codex"),
      model: stringArg(args, "agentModel", "gpt-5.4"),
      effort: stringArg(args, "agentEffort", "high"),
      researcher: agentRoleGuideConfig(args, "researcher"),
      planner: agentRoleGuideConfig(args, "planner"),
      reviewer: agentRoleGuideConfig(args, "reviewer"),
      worker: agentRoleGuideConfig(args, "worker"),
      memoryKeeper: agentRoleGuideConfig(args, "memoryKeeper")
    },
    memory: {
      enabled: true,
      rootPath: "research",
      referencePaths: ["references"]
    },
    sandbox: {
      environment: stringArg(args, "sandboxEnvironment", "none")
    },
    metricContract: {
      rankingMode: "lexicographic",
      metrics: [
        { name: metric, direction, role: "objective" }
      ]
    }
  };

  const sessionDirShell = shellQuote(sessionDir);
  const repoPathGuideArg = path.resolve(sessionDir, repoPath);
  console.log(`Autoresearch session folder setup

1. Create the session folder:

   mkdir -p ${sessionDirShell}/prompts ${sessionDirShell}/context ${sessionDirShell}/baselines ${sessionDirShell}/references

2. Create ${path.join(sessionDir, "session.json")} with this contract:

${JSON.stringify(contract, null, 2)}

3. Replace the project-specific values:

   repoPath: path to the target repo. Relative paths are resolved from the session folder.
   benchmarkCommand: command that runs in the target repo and prints metrics.
   computeBudget.seconds: max benchmark runtime per run.
   maxPlannedConcurrentExperiments: max experiments proposed in one planning cycle.
   sandbox.environment: none, docker, podman, or vercel.
   editablePaths: repo-relative files or globs workers may change.
   immutablePaths: repo-relative files or globs workers must not change.
   runtimeConfigPaths: repo-relative config files planners should inspect.
   metricContract.metrics: ordered objectives; constraints may include role "constraint".

4. Validate without touching Convex:

   autoresearch session add ${sessionDirShell} --dry-run

5. Add or update the session in the local control plane:

   autoresearch session add ${sessionDirShell}

Notes:

   Keep the target repo outside the session folder.
   Do not put secret values in session.json. Use agent.envVars, sandbox.envVars, or local environment variables.
   Start the stack with autoresearch dev before adding a session, or pass --convex-url to session add.

Tailor this guide:

   autoresearch session guide ${sessionDirShell} --repo-path ${shellQuote(repoPathGuideArg)} --slug ${shellQuote(slug)} --title ${shellQuote(title)} --benchmark-command ${shellQuote(benchmarkCommand)} --compute-budget-seconds ${computeBudgetSeconds} --metric ${shellQuote(metric)} --direction ${direction}`);
}

function agentRoleGuideConfig(args, role) {
  return {
    provider: stringArg(args, `${role}AgentProvider`, stringArg(args, "agentProvider", "codex")),
    model: stringArg(args, `${role}AgentModel`, stringArg(args, "agentModel", "gpt-5.4")),
    effort: stringArg(args, `${role}AgentEffort`, stringArg(args, "agentEffort", "high"))
  };
}

function normalizeSessionContract(contract, sessionDir) {
  const slug = requiredString(contract.slug, "slug");
  const repoPath = resolveContractPath(requiredString(contract.repoPath, "repoPath"), sessionDir);
  const metricContract = normalizeMetricContract(contract.metricContract);
  return {
    slug,
    title: requiredString(contract.title, "title"),
    repoPath,
    baseRef: optionalString(contract.baseRef),
    benchmarkCommand: requiredString(contract.benchmarkCommand, "benchmarkCommand"),
    metricParserCommand: optionalString(contract.metricParserCommand),
    computeBudget: normalizeComputeBudgetConfig(contract.computeBudget ?? contract.computeBudgetSeconds),
    targetExperimentCount: requiredPositiveInteger(contract.targetExperimentCount, "targetExperimentCount"),
    maxConcurrentRuns: requiredNonNegativeInteger(contract.maxConcurrentRuns, "maxConcurrentRuns"),
    maxPlannedConcurrentExperiments: optionalPositiveInteger(
      contract.maxPlannedConcurrentExperiments ?? contract.maxPlan,
      "maxPlannedConcurrentExperiments",
      3
    ),
    editablePaths: requiredStringArray(contract.editablePaths, "editablePaths"),
    immutablePaths: stringArray(contract.immutablePaths, "immutablePaths"),
    runtimeConfigPaths: stringArray(contract.runtimeConfigPaths, "runtimeConfigPaths"),
    modelIoContract: optionalString(contract.modelIoContract),
    agent: normalizeAgentConfig(contract.agent),
    memory: normalizeMemoryConfig(contract.memory),
    metricContract,
    sandbox: normalizeSandboxConfig(contract.sandbox),
    earlyStopping: contract.earlyStopping
  };
}

function normalizeMetricContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("metricContract must be an object");
  }
  const topLevelDirection = optionalMetricDirection(
    contract.direction,
    "metricContract.direction"
  );
  const metrics = Array.isArray(contract.metrics)
    ? contract.metrics.map((spec, index) =>
        normalizeMetricSpec(spec, index, topLevelDirection)
      )
    : [];
  const topObjective = metrics.find((spec) => isObjectiveMetricSpec(spec));
  const explicitPrimaryMetric = optionalString(contract.primaryMetric);
  const rankingMode =
    contract.rankingMode ?? (explicitPrimaryMetric ? undefined : "lexicographic");
  const primaryMetric =
    rankingMode === "lexicographic"
      ? topObjective?.name ?? explicitPrimaryMetric
      : explicitPrimaryMetric ?? topObjective?.name;
  if (!primaryMetric) {
    throw new Error(
      "metricContract must include primaryMetric or at least one objective metric"
    );
  }
  const primarySpec = metrics.find((spec) => spec.name === primaryMetric);
  const direction = topLevelDirection ?? primarySpec?.direction ?? topObjective?.direction;
  if (!direction) {
    throw new Error(
      "metricContract.direction or the top objective direction must be minimize or maximize"
    );
  }
  return {
    ...contract,
    primaryMetric,
    direction,
    ...(rankingMode === undefined ? {} : { rankingMode }),
    metrics: metrics.length > 0 ? metrics : [{ name: primaryMetric, direction }]
  };
}

function normalizeMetricSpec(spec, index, fallbackDirection) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`metricContract.metrics[${index}] must be an object`);
  }
  const name = requiredString(spec.name, `metricContract.metrics[${index}].name`);
  const direction =
    optionalMetricDirection(
      spec.direction,
      `metricContract.metrics[${index}].direction`
    ) ??
    fallbackDirection ??
    "minimize";
  return { ...spec, name, direction };
}

function optionalMetricDirection(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  const direction = String(value).trim().toLowerCase();
  if (direction !== "minimize" && direction !== "maximize") {
    throw new Error(`${field} must be minimize or maximize`);
  }
  return direction;
}

function isObjectiveMetricSpec(spec) {
  return String(spec.role ?? "objective") !== "constraint";
}

function normalizeSandboxConfig(value) {
  if (value === undefined || value === null || value === "") {
    return { environment: "none", backend: "direct" };
  }
  if (typeof value === "string") {
    return normalizeSandboxConfig({ environment: value });
  }
  if (!isPlainObject(value)) {
    throw new Error("sandbox must be an object or environment string when provided");
  }
  const rawEnvironment =
    optionalString(value.environment) ??
    optionalString(value.provider) ??
    optionalString(value.backend) ??
    "none";
  const environment = normalizeSandboxEnvironment(rawEnvironment, "sandbox.environment");
  const backend =
    environment === "none"
      ? "direct"
      : "sandcastle";
  const rawBackend = optionalString(value.backend)?.toLowerCase();
  if (
    rawBackend !== undefined &&
    rawBackend !== "sandcastle" &&
    rawBackend !== "direct" &&
    rawBackend !== "none" &&
    rawBackend !== "local" &&
    rawBackend !== "docker" &&
    rawBackend !== "podman" &&
    rawBackend !== "vercel"
  ) {
    throw new Error("sandbox.backend must be none, local, direct, sandcastle, docker, podman, or vercel");
  }
  const provider = optionalString(value.provider)?.toLowerCase();
  if (provider !== undefined && provider !== "none" && provider !== "local" && provider !== "docker" && provider !== "podman" && provider !== "vercel") {
    throw new Error("sandbox.provider must be none, docker, podman, or vercel");
  }
  const normalized = { ...value, environment, backend };
  if (environment === "none") delete normalized.provider;
  else normalized.provider = environment;
  return normalized;
}

function normalizeSandboxEnvironment(value, field) {
  const environment = String(value).trim().toLowerCase();
  if (environment === "local" || environment === "direct") return "none";
  if (
    environment !== "none" &&
    environment !== "docker" &&
    environment !== "podman" &&
    environment !== "vercel" &&
    environment !== "sandcastle"
  ) {
    throw new Error(`${field} must be none, docker, podman, or vercel`);
  }
  return environment === "sandcastle" ? "docker" : environment;
}

function normalizeAgentConfig(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new Error("agent must be an object when provided");
  }
  const provider = normalizeAgentProvider(value.provider, "agent.provider");
  const normalized = { ...value };
  if (provider === undefined) delete normalized.provider;
  else normalized.provider = provider;
  for (const role of AGENT_ROLE_CONFIG_KEYS) {
    if (value[role] !== undefined) {
      normalized[role] = normalizeAgentRoleConfig(value[role], `agent.${role}`);
    }
  }
  return normalized;
}

function normalizeAgentRoleConfig(value, field) {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object when provided`);
  }
  const provider = normalizeAgentProvider(value.provider, `${field}.provider`);
  const normalized = { ...value };
  if (provider === undefined) delete normalized.provider;
  else normalized.provider = provider;
  return normalized;
}

function normalizeAgentProvider(value, field) {
  const provider = optionalString(value)?.toLowerCase();
  if (
    provider !== undefined &&
    provider !== "codex" &&
    provider !== "claude-code" &&
    provider !== "claude" &&
    provider !== "opencode" &&
    provider !== "pi"
  ) {
    throw new Error(`${field} must be codex, claude-code, opencode, or pi`);
  }
  return provider;
}

function normalizeComputeBudgetConfig(value) {
  if (value === undefined || value === null || value === "") {
    return { seconds: DEFAULT_COMPUTE_BUDGET_SECONDS };
  }
  if (typeof value === "number" || typeof value === "string") {
    return { seconds: parseDurationSeconds(value, "computeBudget") };
  }
  if (!isPlainObject(value)) {
    throw new Error("computeBudget must be an object, number of seconds, or duration string");
  }

  const secondsValue =
    value.seconds ??
    value.durationSeconds ??
    value.benchmarkSeconds ??
    value.benchmarkTimeoutSeconds;
  const minutesValue = value.minutes ?? value.durationMinutes;
  const seconds =
    secondsValue !== undefined && secondsValue !== null && secondsValue !== ""
      ? parseDurationSeconds(secondsValue, "computeBudget.seconds")
      : minutesValue !== undefined && minutesValue !== null && minutesValue !== ""
        ? parseDurationMinutes(minutesValue, "computeBudget.minutes")
        : DEFAULT_COMPUTE_BUDGET_SECONDS;
  return { ...value, seconds };
}

function normalizeMemoryConfig(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") {
    return normalizeMemoryConfig({ enabled: value });
  }
  if (!isPlainObject(value)) {
    throw new Error("memory must be an object when provided");
  }

  const enabled = optionalBoolean(value.enabled, "memory.enabled") ?? true;
  const rootPath = normalizeRelativeConfigPath(
    optionalString(value.rootPath) ?? "research",
    "memory.rootPath"
  );
  const normalized = {
    ...value,
    enabled,
    rootPath,
    notesPath: normalizeRelativeConfigPath(
      optionalString(value.notesPath) ?? path.posix.join(rootPath, "notes.md"),
      "memory.notesPath"
    ),
    doNotRepeatPath: normalizeRelativeConfigPath(
      optionalString(value.doNotRepeatPath) ?? path.posix.join(rootPath, "do-not-repeat.md"),
      "memory.doNotRepeatPath"
    ),
    paperIdeasPath: normalizeRelativeConfigPath(
      optionalString(value.paperIdeasPath) ?? path.posix.join(rootPath, "paper-ideas.md"),
      "memory.paperIdeasPath"
    ),
    campaignsPath: normalizeRelativeConfigPath(
      optionalString(value.campaignsPath) ?? path.posix.join(rootPath, "campaigns"),
      "memory.campaignsPath"
    ),
    experimentsPath: normalizeRelativeConfigPath(
      optionalString(value.experimentsPath) ?? path.posix.join(rootPath, "experiments"),
      "memory.experimentsPath"
    ),
    templatesPath: normalizeRelativeConfigPath(
      optionalString(value.templatesPath) ?? path.posix.join(rootPath, "templates"),
      "memory.templatesPath"
    ),
    referencePaths: stringArray(value.referencePaths, "memory.referencePaths").map((item, index) =>
      normalizeRelativeConfigPath(item, `memory.referencePaths[${index}]`)
    ),
    researcher: normalizeMemoryRoleConfig(value.researcher, enabled, "memory.researcher"),
    memoryKeeper: normalizeMemoryRoleConfig(value.memoryKeeper, enabled, "memory.memoryKeeper")
  };
  return normalized;
}

function normalizeMemoryRoleConfig(value, defaultEnabled, field) {
  if (value === undefined || value === null) {
    return { enabled: defaultEnabled };
  }
  if (typeof value === "boolean") {
    return { enabled: value };
  }
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object or boolean when provided`);
  }
  return {
    ...value,
    enabled: optionalBoolean(value.enabled, `${field}.enabled`) ?? defaultEnabled,
    instructions: optionalString(value.instructions)
  };
}

function resolveContractPath(value, sessionDir) {
  return path.isAbsolute(value) ? value : path.resolve(sessionDir, value);
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("optional string field must be a string");
  return value.trim();
}

function optionalBoolean(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function parseDurationSeconds(value, field) {
  if (typeof value === "number") {
    return requiredPositiveDurationSeconds(value, field);
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a positive duration`);
  }
  const trimmed = value.trim().toLowerCase();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return requiredPositiveDurationSeconds(numeric, field);
  }
  const match = trimmed.match(
    /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/,
  );
  if (!match) {
    throw new Error(`${field} must be a positive duration like 300, "300s", or "5m"`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
  return requiredPositiveDurationSeconds(amount * multiplier, field);
}

function parseDurationMinutes(value, field) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) {
    throw new Error(`${field} must be a positive number of minutes`);
  }
  return requiredPositiveDurationSeconds(minutes * 60, field);
}

function requiredPositiveDurationSeconds(value, field) {
  const seconds = Math.ceil(Number(value));
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new Error(`${field} must be at least 1 second`);
  }
  return seconds;
}

function normalizeRelativeConfigPath(value, field) {
  const normalized = requiredString(value, field)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/g, "");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`${field} must be a relative path inside repoPath`);
  }
  return normalized;
}

function requiredStringArray(value, field) {
  const items = stringArray(value, field);
  if (items.length === 0) throw new Error(`${field} must include at least one path pattern`);
  return items;
}

function stringArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

function requiredPositiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function requiredNonNegativeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`);
  return parsed;
}

function optionalPositiveInteger(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return requiredPositiveInteger(value, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sessionGuideRepoPath(args, sessionDir) {
  const rawRepoPath = stringArg(args, "repoPath", "../target-project");
  if (!args.repoPath) return rawRepoPath;
  const repoPath = path.resolve(process.cwd(), rawRepoPath);
  const relativePath = path.relative(sessionDir, repoPath) || ".";
  return normalizePathForJson(relativePath);
}

function stringArg(args, key, fallback) {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${kebabCase(key)} requires a value`);
  }
  return value.trim();
}

function csvArg(args, key, fallback) {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new Error(`--${kebabCase(key)} requires a comma-separated value`);
  }
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new Error(`--${kebabCase(key)} must include at least one item`);
  }
  return items;
}

function metricDirectionArg(args, key, fallback) {
  const value = stringArg(args, key, fallback).toLowerCase();
  if (value !== "minimize" && value !== "maximize") {
    throw new Error(`--${kebabCase(key)} must be minimize or maximize`);
  }
  return value;
}

function positiveIntegerArg(args, key, fallback) {
  if (args[key] === undefined) return fallback;
  if (typeof args[key] !== "string" || args[key].trim() === "") {
    throw new Error(`--${kebabCase(key)} requires a value`);
  }
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${kebabCase(key)} must be a positive integer`);
  }
  return value;
}

function nonNegativeIntegerArg(args, key, fallback) {
  if (args[key] === undefined) return fallback;
  if (typeof args[key] !== "string" || args[key].trim() === "") {
    throw new Error(`--${kebabCase(key)} requires a value`);
  }
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${kebabCase(key)} must be a non-negative integer`);
  }
  return value;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "session";
}

function titleFromSlug(value) {
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Research session";
}

function normalizePathForJson(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function kebabCase(value) {
  return String(value).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function shellQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/g, "'\"'\"'")}'`;
}

function runDoctor() {
  const checks = [
    {
      label: "pdflatex",
      ok: Boolean(findExecutable("pdflatex", ["/Library/TeX/texbin"])),
      hint: "required to compile standalone TikZ sources"
    },
    {
      label: "latexmk",
      ok: Boolean(findExecutable("latexmk", ["/Library/TeX/texbin"])),
      hint: "recommended for robust LaTeX compilation"
    },
    {
      label: "TikZ/PGF",
      ok: kpsewhich("tikz.sty"),
      hint: "install TeX Live package pgf"
    },
    {
      label: "standalone.cls",
      ok: kpsewhich("standalone.cls"),
      hint: "install TeX Live package standalone"
    },
    {
      label: "PNG exporter",
      ok: Boolean(findExecutable("pdftoppm") || findExecutable("qlmanage")),
      hint: "install poppler for pdftoppm or use macOS qlmanage"
    }
  ];

  console.log("Autoresearch doctor");
  let failed = false;
  for (const check of checks) {
    console.log(`  ${check.ok ? "ok " : "err"} ${check.label}${check.ok ? "" : ` - ${check.hint}`}`);
    failed ||= !check.ok;
  }
  if (failed) {
    console.log("");
    console.log("Run `autoresearch install-tex --macos` on macOS, or install TeX Live packages manually.");
    process.exitCode = 1;
  }
}

async function installTex(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log("Usage: autoresearch install-tex --macos");
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("install-tex currently supports macOS only. Install TeX Live manually on this platform.");
  }
  if (!args.macos) {
    throw new Error("Usage: autoresearch install-tex --macos");
  }
  if (!findExecutable("brew")) {
    throw new Error("Homebrew is required for `autoresearch install-tex --macos`.");
  }

  if (!brewPackageInstalled(["list", "--cask", "basictex"])) {
    await runCommand("brew", ["install", "--cask", "basictex"]);
  } else {
    console.log("[tex] basictex already installed");
  }
  if (!brewPackageInstalled(["list", "poppler"])) {
    await runCommand("brew", ["install", "poppler"]);
  } else {
    console.log("[tex] poppler already installed");
  }

  const tlmgr = findExecutable("tlmgr", ["/Library/TeX/texbin"]);
  if (!tlmgr) {
    throw new Error("tlmgr was not found after BasicTeX install. Restart the shell or add /Library/TeX/texbin to PATH.");
  }
  await runCommand("sudo", [tlmgr, "option", "repository", "https://mirror.ctan.org/systems/texlive/tlnet"]);
  await runCommand("sudo", [tlmgr, "update", "--self"]);
  await runCommand("sudo", [tlmgr, "install", "pgf", "standalone", "latexmk", "lm", "microtype"]);
  runDoctor();
}

function kpsewhich(fileName) {
  const kpsewhichBin = findExecutable("kpsewhich", ["/Library/TeX/texbin"]);
  if (!kpsewhichBin) return false;
  const result = spawnSync(kpsewhichBin, [fileName], {
    env: texProcessEnv(),
    stdio: "ignore"
  });
  return result.status === 0;
}

function findExecutable(name, extraDirs = []) {
  const pathEntries = [
    ...extraDirs,
    ...(process.env.PATH ?? "").split(path.delimiter)
  ].filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".cmd", ".exe"] : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function brewPackageInstalled(args) {
  return spawnSync("brew", args, { stdio: "ignore" }).status === 0;
}

function texProcessEnv() {
  return {
    ...process.env,
    PATH: ["/Library/TeX/texbin", process.env.PATH].filter(Boolean).join(path.delimiter)
  };
}

async function runScript(script, argv) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", script), ...argv], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with ${code}`));
    });
  });
}

async function runCommand(command, argv) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      env: texProcessEnv(),
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${argv.join(" ")} exited with ${code}`));
    });
  });
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") {
      parsed._.push(...argv.slice(index + 1));
      break;
    }
    if (item === "-h") {
      parsed.h = true;
      continue;
    }
    if (!item.startsWith("--") || item === "-") {
      parsed._.push(item);
      continue;
    }
    const equalsIndex = item.indexOf("=");
    const rawKey = equalsIndex >= 0 ? item.slice(2, equalsIndex) : item.slice(2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (equalsIndex >= 0) {
      parsed[key] = item.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^"|"$/g, "");
  }
  return values;
}

function printHelp() {
  console.log(`Usage:
  autoresearch init [project-dir] [--force]
  autoresearch dev
  autoresearch session guide [session-dir] [guide options]
  autoresearch session add <session-dir> [--convex-url URL] [--dry-run]
  autoresearch doctor
  autoresearch install-tex --macos
  autoresearch runner [runner options]
  autoresearch orchestrator [orchestrator options]`);
}

function printInitHelp() {
  console.log(`Usage:
  autoresearch init [project-dir] [--force]

Creates a .autoresearch folder in the project with user and agent setup docs,
plus a reference session at .autoresearch/sessions/example.

Options:
  --force   Rewrite scaffolded files that already exist.`);
}

function printSessionHelp() {
  console.log(`Usage:
  autoresearch session guide [session-dir] [guide options]
  autoresearch session add <session-dir> [--convex-url URL] [--dry-run]

Session commands:
  guide       Print exact session folder setup and session.json guidance.
  add         Add or update a session from session.json through Convex.`);
}

function printSessionGuideHelp() {
  console.log(`Usage:
  autoresearch session guide [session-dir] [guide options]

Guide options:
  --repo-path PATH
  --slug SLUG
  --title TITLE
  --benchmark-command COMMAND
  --compute-budget-seconds N
  --max-planned-concurrent-experiments N
  --sandbox-environment none|docker|podman|vercel
  --metric NAME
  --direction minimize|maximize
  --target-experiment-count N
  --max-concurrent-runs N
  --editable-paths CSV
  --immutable-paths CSV
  --runtime-config-paths CSV
  --agent-provider NAME
  --agent-model NAME
  --agent-effort LEVEL
  --planner-agent-provider NAME
  --planner-agent-model NAME
  --worker-agent-provider NAME
  --worker-agent-model NAME`);
}

function printSessionAddHelp() {
  console.log(`Usage:
  autoresearch session add <session-dir> [--convex-url URL] [--dry-run]

Adds or updates a session from <session-dir>/session.json.

Options:
  --convex-url URL   Convex deployment URL. Defaults to CONVEX_URL, VITE_CONVEX_URL, or .env.local.
  --dry-run          Print the resolved payload without contacting Convex.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
