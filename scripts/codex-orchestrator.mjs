#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import {
  createAgentProvider,
  resolveAgentRoleConfig
} from "./agent-providers.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_WORKSPACE_ROOT = path.resolve(ROOT, "..", ".runtime", "codex-orchestrator");
const MODEL_DIAGRAM_SKILL_NAME = "$model-diagram-tikz";
const MODEL_DIAGRAM_SKILL_PATH = ".agents/skills/model-diagram-tikz/SKILL.md";
const DEFAULT_MODEL_DIAGRAM_SOURCE = "figures/model_architecture.tex";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = loadEnvFile(path.join(ROOT, ".env.local"));
  const convexUrl = args.convexUrl ?? process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? envFile.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing Convex URL. Set CONVEX_URL or run `npm run convex:dev:local` first.");
  }

  const client = new ConvexHttpClient(convexUrl);
  const workerId = args.workerId ?? `planner-${os.hostname()}-${process.pid}`;
  const pollMs = Number(args.pollMs ?? 10000);
  console.log(`Agent orchestrator ${workerId} connected to ${convexUrl}`);

  while (true) {
    const claim = await client.mutation(api.orchestration.claimPlanningCycle, {
      sessionId: args.sessionId,
      workerId,
      requestedCount: args.count ? Number(args.count) : undefined
    });
    if (!claim) {
      if (args.once) {
        console.log("No session needs planning.");
        return;
      }
      await sleep(pollMs);
      continue;
    }

    try {
      await runPlanningCycle(client, claim, args);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      await client.mutation(api.orchestration.failPlanningCycle, {
        planningCycleId: claim.planningCycleId,
        error: message.slice(0, 4000)
      });
    }

    if (args.once) {
      return;
    }
  }
}

async function runPlanningCycle(client, claim, args) {
  const { session, experiments, patches, requestedCount, planningCycleId } = claim;
  const repoPath = path.resolve(ROOT, session.repoPath);
  const cycleDir = path.join(DEFAULT_WORKSPACE_ROOT, slug(session.slug), String(Date.now()));
  fs.mkdirSync(cycleDir, { recursive: true });

  const memorySnapshot = readMemorySnapshot(repoPath, session.memory);
  const researcherOutput = shouldRunResearcher(session)
    ? await runOrchestratorAgent({
        role: "researcher",
        session,
        cwd: fs.existsSync(repoPath) ? repoPath : ROOT,
        outputPath: path.join(cycleDir, "researcher-final.md"),
        prompt: buildResearcherPrompt({ session, experiments, patches, requestedCount, memorySnapshot }),
        args,
        dryRunOutput: { candidates: [], rejected: [] }
      })
    : "";
  const research = researcherOutput ? parseJsonObject(researcherOutput, "researcher") : null;

  const plannerPrompt = buildPlannerPrompt({
    session,
    experiments,
    patches,
    requestedCount,
    memorySnapshot,
    research
  });
  const plannerOutput = await runOrchestratorAgent({
    role: "planner",
    session,
    cwd: fs.existsSync(repoPath) ? repoPath : ROOT,
    outputPath: path.join(cycleDir, "planner-final.md"),
    prompt: plannerPrompt,
    args,
    dryRunOutput: dryRunPlan(requestedCount)
  });
  const plan = parseJsonObject(plannerOutput, "planner");

  const reviewerPrompt = buildReviewerPrompt({
    session,
    experiments,
    plan,
    requestedCount,
    memorySnapshot,
    research
  });
  const reviewerOutput = await runOrchestratorAgent({
    role: "reviewer",
    session,
    cwd: fs.existsSync(repoPath) ? repoPath : ROOT,
    outputPath: path.join(cycleDir, "reviewer-final.md"),
    prompt: reviewerPrompt,
    args,
    dryRunOutput: dryRunReview()
  });
  const review = parseJsonObject(reviewerOutput, "reviewer");
  const approved = normalizeApprovedExperiments(review, plan, requestedCount);

  if (approved.length === 0) {
    throw new Error("reviewer approved no experiments");
  }

  console.log(`Finishing planning cycle ${planningCycleId} with ${approved.length} approved experiments`);
  await client.mutation(api.orchestration.finishPlanningCycle, {
    planningCycleId,
    researcherOutput: researcherOutput || undefined,
    plannerOutput,
    reviewerOutput,
    approvedExperiments: approved
  });
  console.log(`Queued ${approved.length} approved experiments for ${session.slug}`);
}

function buildResearcherPrompt({ session, experiments, patches, requestedCount, memorySnapshot }) {
  const recent = formatRecentExperiments(experiments, 30);
  const recentPatches = formatRecentPatches(patches, 12);
  const memory = normalizeMemoryConfig(session.memory);

  return `You are the researcher for a Convex-backed ML autoresearch system.

Scout for paper-derived or reference-derived experiment ideas before the planner chooses the next batch.

Session:
${JSON.stringify({
  title: session.title,
  slug: session.slug,
  benchmarkCommand: session.benchmarkCommand,
  computeBudget: session.computeBudget,
  requestedCount,
  editablePaths: session.editablePaths,
  immutablePaths: session.immutablePaths,
  runtimeConfigPaths: session.runtimeConfigPaths,
  modelIoContract: session.modelIoContract,
  metricContract: session.metricContract,
  bestMetrics: session.bestMetrics
}, null, 2)}

Durable memory paths:
${formatMemoryPaths(memory)}

Durable memory excerpts:
${formatMemorySnapshot(memorySnapshot)}

Recent experiments:
${recent || "- none"}

Recent patches:
${recentPatches || "- none"}

Rules:
- Read the configured memory and reference paths when they exist.
- Do not edit files, run benchmarks, or claim a result is a win without benchmark evidence.
- Translate references into clean single-change hypotheses that fit editable paths.
- For architecture_change candidates, write the worker prompt so the worker directly uses ${MODEL_DIAGRAM_SKILL_NAME}, reads ${MODEL_DIAGRAM_SKILL_PATH}, and creates or updates only an editable TikZ `.tex` model diagram source for the diagram artifact.
- If no diagram source exists yet for an architecture_change, tell the worker to create one, preferably ${DEFAULT_MODEL_DIAGRAM_SOURCE} when that path is editable.
- Tell the worker not to compile, render, or create PDF/PNG diagram files; the local runner processes the accepted `.tex` source into PNG.
- Reject ideas already present in current code, prior experiments, or do-not-repeat guidance.
- Prefer concrete follow-ups over broad research themes.
${memory?.researcher?.instructions ? `\nAdditional researcher instructions:\n${memory.researcher.instructions}` : ""}

Return only JSON:
{
  "candidates": [
    {
      "hypothesis": "specific single-change hypothesis",
      "changeKind": "architecture_change or config_change",
      "prompt": "smallest credible worker instruction",
      "rationale": "why this maps to the current target repo",
      "risk": "main failure mode",
      "source": "paper, reference path, or memory source"
    }
  ],
  "rejected": [
    { "idea": "rejected idea", "reason": "duplicate, stale, too broad, or incompatible" }
  ]
}`;
}

function buildPlannerPrompt({ session, experiments, patches, requestedCount, memorySnapshot, research }) {
  const recent = experiments
    ? formatRecentExperiments(experiments, 20)
    : "";
  const recentPatches = formatRecentPatches(patches, 8);
  const memory = normalizeMemoryConfig(session.memory);

  return `You are the planner for a Convex-backed ML autoresearch system.

Plan ${requestedCount} independent, non-duplicate experiments that can run in parallel.

Session:
${JSON.stringify({
  title: session.title,
  slug: session.slug,
  benchmarkCommand: session.benchmarkCommand,
  computeBudget: session.computeBudget,
  targetExperimentCount: session.targetExperimentCount,
  completedExperimentCount: session.completedExperimentCount,
  maxConcurrentRuns: session.maxConcurrentRuns,
  maxPlannedConcurrentExperiments: session.maxPlannedConcurrentExperiments,
  editablePaths: session.editablePaths,
  immutablePaths: session.immutablePaths,
  runtimeConfigPaths: session.runtimeConfigPaths,
  modelIoContract: session.modelIoContract,
  metricContract: session.metricContract,
  bestMetrics: session.bestMetrics
}, null, 2)}

Recent experiments:
${recent || "- none"}

Recent patches:
${recentPatches || "- none"}

Durable memory:
${memory ? formatMemorySnapshot(memorySnapshot) : "- disabled"}

Researcher candidates:
${research ? JSON.stringify(research, null, 2) : "- researcher disabled or no candidates"}

Rules:
- Propose only changes that fit editable paths.
- Prefer independent changes that can run in parallel without depending on each other.
- Avoid duplicate or stale hypotheses.
- Use durable memory and researcher candidates to avoid repeats and stale ideas.
- Each experiment must be one coherent change.
- For architecture_change experiments, include worker instructions to use ${MODEL_DIAGRAM_SKILL_NAME}, read ${MODEL_DIAGRAM_SKILL_PATH}, and create or update only an editable TikZ `.tex` model diagram source for the diagram artifact.
- If an architecture_change has no existing diagram source, tell the worker to create one, preferably ${DEFAULT_MODEL_DIAGRAM_SOURCE} when that path is editable.
- Tell the worker not to compile, render, or create PDF/PNG diagram files; the local runner processes the accepted `.tex` source into PNG.
- Do not change data, benchmark command, metric parsing, immutable files, target definitions, credentials, or deployment behavior.

Return only JSON:
{
  "experiments": [
    {
      "hypothesis": "specific single-change hypothesis",
      "changeKind": "architecture_change or config_change",
      "prompt": "worker-specific instructions including exact files/surfaces to edit",
      "expectedImpact": "why this may improve the metric",
      "independenceReason": "why it can run in parallel with the others"
    }
  ]
}`;
}

function buildReviewerPrompt({ session, experiments, plan, requestedCount, memorySnapshot, research }) {
  const memory = normalizeMemoryConfig(session.memory);
  return `You are the reviewer for an ML autoresearch batch.

Review the proposed experiments for hard-rule violations, duplicates, stale ideas, multi-change scope, and dependency between experiments.
Approve at most ${requestedCount} experiments that are safe to run in parallel.

Session editable paths:
${session.editablePaths.map((item) => `- ${item}`).join("\n")}

Immutable paths:
${session.immutablePaths.map((item) => `- ${item}`).join("\n")}

Prior experiments:
${experiments.slice(-20).map((item) => `- #${item.ordinal} ${item.status}: ${item.hypothesis}`).join("\n") || "- none"}

Durable memory:
${memory ? formatMemorySnapshot(memorySnapshot) : "- disabled"}

Researcher candidates:
${research ? JSON.stringify(research, null, 2) : "- researcher disabled or no candidates"}

Planner proposal:
${JSON.stringify(plan, null, 2)}

Rules:
- Reject architecture_change proposals whose worker prompt does not require ${MODEL_DIAGRAM_SKILL_NAME} and creation or update of only an editable TikZ `.tex` model diagram source for the diagram artifact.
- Reject architecture_change proposals that need a new diagram source but do not name an editable `.tex` path such as ${DEFAULT_MODEL_DIAGRAM_SOURCE}.
- Reject architecture_change proposals that ask the worker to compile, render, or create PDF/PNG diagram files.

Return only JSON:
{
  "approvedExperiments": [
    {
      "hypothesis": "approved hypothesis",
      "changeKind": "architecture_change or config_change",
      "prompt": "worker-specific instructions"
    }
  ],
  "rejected": [
    { "hypothesis": "rejected hypothesis", "reason": "why" }
  ]
}`;
}

async function runOrchestratorAgent({ role, session, cwd, outputPath, prompt, args, dryRunOutput }) {
  if (args.dryRun) {
    return JSON.stringify(dryRunOutput ?? dryRunPlan(1));
  }

  const config = resolveOrchestratorAgentConfig(session, args, role);
  const provider = createAgentProvider(config);
  const printCommand = provider.buildPrintCommand({
    prompt,
    dangerouslySkipPermissions: false
  });
  console.log(`Running ${role} with ${config.agentProvider}/${config.model}`);
  const result = await runAgentProviderCommand({
    role,
    cwd,
    command: printCommand.command,
    input: printCommand.stdin,
    env: provider.env,
    provider
  });
  const final = result.result || result.stdout || "";
  fs.writeFileSync(outputPath, final, "utf8");
  if (result.code !== 0) {
    throw new Error(`${role} ${config.agentProvider} exited ${result.code}: ${(result.stderr || final).slice(-2000)}`);
  }
  if (!final.trim()) {
    throw new Error(`${role} ${config.agentProvider} completed without output`);
  }
  return final;
}

function resolveOrchestratorAgentConfig(session, args, role) {
  const sandbox = isPlainObject(session.sandbox) ? session.sandbox : {};
  return resolveAgentRoleConfig({
    role,
    sessionAgent: session.agent,
    sandboxAgent: sandbox.agent,
    args,
    providerOverrides: [
      args.orchestratorAgentProvider,
      args.agentProvider,
      args.agent,
      process.env.AUTORESEARCH_ORCHESTRATOR_AGENT_PROVIDER,
      process.env.AUTORESEARCH_AGENT_PROVIDER
    ],
    modelOverrides: [
      args.orchestratorAgentModel,
      args.agentModel,
      args.model,
      process.env.AUTORESEARCH_ORCHESTRATOR_AGENT_MODEL,
      process.env.AUTORESEARCH_AGENT_MODEL,
      process.env.AUTORESEARCH_CODEX_MODEL
    ],
    effortOverrides: [
      args.orchestratorAgentEffort,
      args.agentEffort,
      args.effort,
      process.env.AUTORESEARCH_ORCHESTRATOR_AGENT_EFFORT,
      process.env.AUTORESEARCH_AGENT_EFFORT
    ]
  });
}

function dryRunPlan() {
  return {
    experiments: [
      {
        hypothesis: "Dry-run config change placeholder.",
        changeKind: "config_change",
        prompt: "Dry-run only; do not execute.",
        expectedImpact: "none",
        independenceReason: "dry-run"
      }
    ]
  };
}

function dryRunReview() {
  return {
    approvedExperiments: [
      {
        hypothesis: "Dry-run config change placeholder.",
        changeKind: "config_change",
        prompt: "Dry-run only; do not execute."
      }
    ],
    rejected: []
  };
}

function normalizeApprovedExperiments(review, plan, requestedCount) {
  const source = Array.isArray(review.approvedExperiments)
    ? review.approvedExperiments
    : Array.isArray(plan.experiments)
      ? plan.experiments
      : [];
  return source
    .slice(0, requestedCount)
    .map((item) => ({
      hypothesis: String(item.hypothesis || "").trim(),
      changeKind: normalizeChangeKind(item.changeKind || item.change_kind),
      prompt: String(item.prompt || item.workerPrompt || item.instructions || "").trim()
    }))
    .filter((item) => item.hypothesis && item.prompt);
}

function normalizeChangeKind(value) {
  const normalized = String(value || "").trim();
  return normalized === "architecture_change" || normalized === "config_change"
    ? normalized
    : "config_change";
}

function parseJsonObject(text, source) {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }
  throw new Error(`${source} output did not contain a JSON object`);
}

function shouldRunResearcher(session) {
  const memory = normalizeMemoryConfig(session.memory);
  return Boolean(memory && memory.enabled !== false && memory.researcher?.enabled !== false);
}

function normalizeMemoryConfig(value) {
  if (!isPlainObject(value) || value.enabled === false) {
    return null;
  }
  const rootPath = normalizeRelativePath(value.rootPath || "research");
  return {
    ...value,
    enabled: true,
    rootPath,
    notesPath: normalizeRelativePath(value.notesPath || path.posix.join(rootPath, "notes.md")),
    doNotRepeatPath: normalizeRelativePath(value.doNotRepeatPath || path.posix.join(rootPath, "do-not-repeat.md")),
    paperIdeasPath: normalizeRelativePath(value.paperIdeasPath || path.posix.join(rootPath, "paper-ideas.md")),
    campaignsPath: normalizeRelativePath(value.campaignsPath || path.posix.join(rootPath, "campaigns")),
    experimentsPath: normalizeRelativePath(value.experimentsPath || path.posix.join(rootPath, "experiments")),
    templatesPath: normalizeRelativePath(value.templatesPath || path.posix.join(rootPath, "templates")),
    referencePaths: Array.isArray(value.referencePaths)
      ? value.referencePaths.map((item) => normalizeRelativePath(item)).filter(Boolean)
      : [],
    researcher: normalizeMemoryRoleConfig(value.researcher, true),
    memoryKeeper: normalizeMemoryRoleConfig(value.memoryKeeper, true)
  };
}

function normalizeMemoryRoleConfig(value, defaultEnabled) {
  if (typeof value === "boolean") return { enabled: value };
  if (isPlainObject(value)) {
    return { ...value, enabled: value.enabled !== false };
  }
  return { enabled: defaultEnabled };
}

function readMemorySnapshot(repoPath, value) {
  const memory = normalizeMemoryConfig(value);
  if (!memory) return [];
  const paths = [
    memory.notesPath,
    memory.doNotRepeatPath,
    memory.paperIdeasPath,
    memory.campaignsPath,
    memory.experimentsPath,
    ...memory.referencePaths
  ];
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  return uniquePaths.map((relativePath) => summarizeMemoryPath(repoPath, relativePath));
}

function summarizeMemoryPath(repoPath, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  try {
    const absolutePath = safeResolveRepoPath(repoPath, normalized);
    if (!fs.existsSync(absolutePath)) {
      return { path: normalized, status: "missing" };
    }
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .sort()
        .slice(0, 25);
      return { path: normalized, status: "directory", entries };
    }
    if (!stat.isFile()) {
      return { path: normalized, status: "not-file" };
    }
    const content = safeReadText(absolutePath);
    return {
      path: normalized,
      status: "file",
      excerpt: tail(content, 6000)
    };
  } catch (error) {
    return {
      path: normalized,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function formatMemoryPaths(memory) {
  if (!memory) return "- disabled";
  const paths = [
    ["notes", memory.notesPath],
    ["do-not-repeat", memory.doNotRepeatPath],
    ["paper ideas", memory.paperIdeasPath],
    ["campaigns", memory.campaignsPath],
    ["experiments", memory.experimentsPath],
    ["templates", memory.templatesPath],
    ...memory.referencePaths.map((item) => ["reference", item])
  ];
  return paths.map(([label, value]) => `- ${label}: ${value}`).join("\n");
}

function formatMemorySnapshot(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return "- none";
  }
  return snapshot.map((item) => {
    if (item.status === "file") {
      return `## ${item.path}\n${item.excerpt || "(empty)"}`;
    }
    if (item.status === "directory") {
      return `## ${item.path}\n${item.entries.length ? item.entries.map((entry) => `- ${entry}`).join("\n") : "(empty directory)"}`;
    }
    if (item.status === "missing") {
      return `## ${item.path}\n(missing)`;
    }
    return `## ${item.path}\n(${item.status}: ${item.error || "not readable"})`;
  }).join("\n\n").slice(-24000);
}

function formatRecentExperiments(experiments, count) {
  return experiments
    .slice(-count)
    .map((experiment) => {
      const metrics = experiment.metrics ? JSON.stringify(experiment.metrics) : "{}";
      return `- #${experiment.ordinal} ${experiment.status}: ${experiment.hypothesis} metrics=${metrics}`;
    })
    .join("\n");
}

function formatRecentPatches(patches, count) {
  return patches
    .slice(0, count)
    .map((patch) => `- ${patch.status} ${String(patch.contentHash || "").slice(0, 12)} files=${(patch.changedFiles || []).join(", ")}`)
    .join("\n");
}

function safeResolveRepoPath(repoPath, relativePath) {
  const repoRoot = path.resolve(repoPath);
  const absolutePath = path.resolve(repoRoot, normalizeRelativePath(relativePath));
  if (absolutePath !== repoRoot && !absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Path escapes repoPath: ${relativePath}`);
  }
  return absolutePath;
}

function safeReadText(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return "[binary file omitted]";
  }
  return buffer.toString("utf8");
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/^"|"$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/g, "");
}

function tail(value, maxChars) {
  const text = String(value ?? "");
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runAgentProviderCommand({ role, cwd, command, input, env, provider }) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let result = "";
    let stdoutLineBuffer = "";

    const emitParsedLine = (line) => {
      const parsed = provider.parseStreamLine(line);
      if (parsed.length === 0) {
        if (line.trim()) process.stdout.write(`${line}\n`);
        return;
      }
      for (const event of parsed) {
        if (event.type === "text") {
          process.stdout.write(event.text);
        } else if (event.type === "result") {
          result = event.result;
        } else if (event.type === "tool_call") {
          process.stdout.write(`[${role} tool:${event.name}] ${event.args}\n`);
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutLineBuffer += text;
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        emitParsedLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      stderr += String(error);
    });
    child.on("close", (code) => {
      if (stdoutLineBuffer) {
        emitParsedLine(stdoutLineBuffer);
      }
      resolve({ code: code ?? 1, stdout, stderr, result });
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--once") args.once = true;
    else if (item === "--dry-run") args.dryRun = true;
    else if (item.startsWith("--")) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

function slug(value) {
  return String(value || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
