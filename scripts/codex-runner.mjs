#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_WORKSPACE_ROOT = path.resolve(ROOT, "..", ".runtime", "codex-runner");
const RUNNER_METADATA_FILES = new Set([
  "AUTORESEARCH_PROMPT.md",
  "AUTORESEARCH_CODEX_FINAL.md",
  "AUTORESEARCH_EXPERIMENT.json"
]);
const GENERATED_ARTIFACT_PARTS = new Set([
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".cache"
]);
const GENERATED_ARTIFACT_SUFFIXES = [
  ".pyc",
  ".pyo",
  ".log",
  ".tmp"
];
const MAX_PATCH_DIFF_CHARS = 750_000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = loadEnvFile(path.join(ROOT, ".env.local"));
  const convexUrl = args.convexUrl ?? process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? envFile.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing Convex URL. Set CONVEX_URL or run `npm run convex:dev:local` first.");
  }

  const client = new ConvexHttpClient(convexUrl);
  const workerId = args.workerId ?? `${os.hostname()}-${process.pid}`;
  const pollMs = Number(args.pollMs ?? 5000);

  console.log(`Codex runner ${workerId} connected to ${convexUrl}`);
  while (true) {
    const claim = await client.mutation(api.orchestration.claimNextExperiment, { workerId });
    if (!claim) {
      if (args.once) {
        console.log("No queued work.");
        return;
      }
      await sleep(pollMs);
      continue;
    }

    try {
      await runClaim(client, claim, args);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      await client.mutation(api.orchestration.failRun, {
        runId: claim.runId,
        error: message.slice(0, 4000)
      });
    }

    if (args.once) {
      return;
    }
  }
}

async function runClaim(client, claim, args) {
  const { session, basePatch, experiment, runId, priorExperiments } = claim;
  const workspacePath = prepareWorkspace({ session, basePatch, experiment, runId, args });
  const prompt = buildCodexPrompt({ session, basePatch, experiment, priorExperiments, workspacePath });
  const promptPath = path.join(workspacePath, "AUTORESEARCH_PROMPT.md");
  const finalPath = path.join(workspacePath, "AUTORESEARCH_CODEX_FINAL.md");
  fs.writeFileSync(promptPath, prompt, "utf8");

  await client.mutation(api.orchestration.startRun, { runId, workspacePath });
  await client.mutation(api.orchestration.appendAgentMessage, {
    sessionId: session._id,
    experimentId: experiment._id,
    runId,
    role: "system",
    source: "codex-runner",
    sequence: 1,
    content: `Workspace prepared at ${workspacePath}`
  });

  if (args.dryRun) {
    await client.mutation(api.orchestration.appendAgentMessage, {
      sessionId: session._id,
      experimentId: experiment._id,
      runId,
      role: "assistant",
      source: "codex-runner",
      sequence: 2,
      content: "Dry run: skipped codex and benchmark execution."
    });
    await client.mutation(api.orchestration.completeRun, {
      runId,
      patchId: await recordSyntheticDryRunPatch(client, { runId, session, experiment, workspacePath }),
      codexExitCode: 0,
      benchmarkExitCode: 0,
      metrics: {},
      summary: "dry run"
    });
    return;
  }

  const codexBin = args.codexBin ?? process.env.AUTORESEARCH_CODEX_BIN ?? "codex";
  const codexArgs = [
    "exec",
    "--cd",
    workspacePath,
    "--skip-git-repo-check",
    "--output-last-message",
    finalPath,
    "--dangerously-bypass-approvals-and-sandbox",
    "-"
  ];
  const codex = await runProcess({
    client,
    runId,
    cwd: workspacePath,
    command: codexBin,
    args: codexArgs,
    input: prompt,
    stdoutStream: "codex_stdout",
    stderrStream: "codex_stderr"
  });

  const plan = readExperimentPlan(workspacePath);
  if (plan) {
    await client.mutation(api.orchestration.updateExperimentPlan, {
      experimentId: experiment._id,
      hypothesis: String(plan.hypothesis || experiment.hypothesis),
      changeKind: String(plan.changeKind || plan.change_kind || experiment.changeKind)
    });
  }
  if (fs.existsSync(finalPath)) {
    await client.mutation(api.orchestration.appendAgentMessage, {
      sessionId: session._id,
      experimentId: experiment._id,
      runId,
      role: "assistant",
      source: "codex-cli",
      sequence: 3,
      content: fs.readFileSync(finalPath, "utf8").slice(-12000)
    });
  }

  if (codex.code !== 0) {
    await client.mutation(api.orchestration.failRun, {
      runId,
      error: `codex exited with ${codex.code}`,
      codexExitCode: codex.code
    });
    return;
  }

  const patch = collectPatch(workspacePath, session);
  const patchResult = await client.mutation(api.orchestration.recordPatch, {
    runId,
    workspacePath,
    changedFiles: patch.changedFiles,
    rejectedFiles: patch.rejectedFiles,
    editablePaths: session.editablePaths,
    immutablePaths: session.immutablePaths,
    diff: patch.diff,
    diffStat: patch.diffStat,
    contentHash: patch.contentHash,
    rejectionReason: patch.rejectionReason
  });

  if (patch.changedFiles.length === 0) {
    await client.mutation(api.orchestration.failRun, {
      runId,
      error: "codex completed without changing any tracked files",
      codexExitCode: codex.code
    });
    return;
  }

  if (patchResult.status !== "accepted") {
    await client.mutation(api.orchestration.failRun, {
      runId,
      error: patchResult.rejectionReason || "patch rejected",
      codexExitCode: codex.code
    });
    return;
  }

  const benchmark = await runProcess({
    client,
    runId,
    cwd: workspacePath,
    command: session.benchmarkCommand,
    shell: true,
    stdoutStream: "benchmark_stdout",
    stderrStream: "benchmark_stderr"
  });
  const summaryText = [benchmark.stdout, benchmark.stderr].join("\n");
  const metrics = parseMetrics(summaryText, session.metricContract);

  if (Object.keys(metrics).length === 0) {
    await client.mutation(api.orchestration.failRun, {
      runId,
      error: "benchmark completed without parseable numeric metrics",
      codexExitCode: codex.code,
      benchmarkExitCode: benchmark.code
    });
    return;
  }

  await client.mutation(api.orchestration.completeRun, {
    runId,
    patchId: patchResult.patchId,
    codexExitCode: codex.code,
    benchmarkExitCode: benchmark.code,
    metrics,
    summary: extractLastJson(summaryText) ?? summaryText.slice(-4000)
  });
}

function prepareWorkspace({ session, basePatch, experiment, runId, args }) {
  const workspaceRoot = path.resolve(args.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT);
  const runSlug = `${String(experiment.ordinal).padStart(3, "0")}-${slug(experiment.hypothesis)}-${shortId(runId)}`;
  const destination = path.join(workspaceRoot, slug(session.slug), runSlug);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    throw new Error(`workspace already exists: ${destination}`);
  }

  const repoPath = path.resolve(ROOT, session.repoPath);
  if (!fs.existsSync(repoPath)) {
    throw new Error(`repoPath does not exist: ${repoPath}`);
  }

  if (fs.existsSync(path.join(repoPath, ".git"))) {
    runSync("git", ["worktree", "add", "--detach", destination, session.baseRef ?? "HEAD"], repoPath);
  } else {
    fs.cpSync(repoPath, destination, {
      recursive: true,
      filter: (source) => !shouldSkipCopy(source)
    });
    runSync("git", ["init"], destination);
    runSync("git", ["config", "user.email", "autoresearch@example.local"], destination);
    runSync("git", ["config", "user.name", "Autoresearch Runner"], destination);
    runSync("git", ["add", "."], destination);
    runSync("git", ["commit", "-m", "baseline"], destination);
  }
  applyBasePatch(destination, basePatch);
  return destination;
}

function applyBasePatch(workspacePath, basePatch) {
  if (!basePatch?.diff) {
    return;
  }
  const patchPath = path.join(workspacePath, ".autoresearch_base.patch");
  fs.writeFileSync(patchPath, basePatch.diff, "utf8");
  try {
    runSync("git", ["apply", "--whitespace=nowarn", patchPath], workspacePath);
    fs.rmSync(patchPath, { force: true });
    runSync("git", ["add", "."], workspacePath);
    runSync("git", ["commit", "-m", `rollback baseline ${String(basePatch.contentHash || "").slice(0, 12)}`], workspacePath);
  } finally {
    fs.rmSync(patchPath, { force: true });
  }
}

function buildCodexPrompt({ session, basePatch, experiment, priorExperiments, workspacePath }) {
  const prior = priorExperiments
    .slice(-12)
    .map((item) => {
      const metrics = item.metrics ? JSON.stringify(item.metrics) : "{}";
      return `- #${item.ordinal} ${item.status}: ${item.hypothesis} metrics=${metrics}`;
    })
    .join("\n");

  return `You are the experiment worker for an ML autoresearch session.

Workspace:
${workspacePath}

Session:
- ${session.title}
- Benchmark command: ${session.benchmarkCommand}
- Target experiments: ${session.targetExperimentCount}
- Primary metric contract:
${JSON.stringify(session.metricContract, null, 2)}

Editable paths:
${session.editablePaths.map((item) => `- ${item}`).join("\n")}

Runtime config paths:
${session.runtimeConfigPaths.map((item) => `- ${item}`).join("\n") || "- none declared"}

Immutable paths:
${session.immutablePaths.map((item) => `- ${item}`).join("\n")}

Model IO contract:
${session.modelIoContract || "Preserve the existing public model inputs and outputs."}

Prior experiments:
${prior || "- none"}

Rollback baseline:
${basePatch ? `Continuing from accepted patch ${String(basePatch.contentHash || "").slice(0, 12)}.` : "Session root."}

Experiment slot:
- ordinal: ${experiment.ordinal}
- queued hypothesis: ${experiment.hypothesis}
- change kind: ${experiment.changeKind}

Rules:
- Make exactly one coherent research change.
- You may make PyTorch architecture changes if model inputs and outputs stay compatible.
- You may make runtime config or hyperparameter changes in declared config files.
- Do not edit immutable paths, benchmark code, metric parsing, data splits, datasets, or objective definitions.
- Do not change credentials, deployment behavior, data definitions, or objective definitions.
- Keep the change scoped and easy to inspect.
- The runner will execute the benchmark after you finish; avoid long training runs unless needed for a quick syntax check.

Before finishing, write AUTORESEARCH_EXPERIMENT.json in the workspace:
{
  "hypothesis": "specific one-sentence hypothesis",
  "changeKind": "architecture_change or config_change",
  "changedFiles": ["relative/path.py"]
}

Final response must include hypothesis, files changed, validation performed, and expected metric impact.`;
}

async function runProcess({
  client,
  runId,
  cwd,
  command,
  args = [],
  input,
  shell = false,
  stdoutStream,
  stderrStream
}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let sequence = Date.now();
    let stdout = "";
    let stderr = "";

    const append = async (stream, chunk) => {
      const text = chunk.toString();
      if (stream === stdoutStream) stdout += text;
      if (stream === stderrStream) stderr += text;
      process[stream.includes("stderr") ? "stderr" : "stdout"].write(text);
      sequence += 1;
      try {
        await client.mutation(api.orchestration.appendRunLog, {
          runId,
          stream,
          sequence,
          chunk: text.slice(-8000)
        });
      } catch (error) {
        console.error(`failed to append ${stream}:`, error);
      }
    };

    child.stdout.on("data", (chunk) => void append(stdoutStream, chunk));
    child.stderr.on("data", (chunk) => void append(stderrStream, chunk));
    child.on("error", (error) => {
      stderr += String(error);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function parseMetrics(text, contract) {
  const metrics = {};
  const parsedJson = extractLastJson(text);
  if (parsedJson) {
    collectNumericMetrics(metrics, JSON.parse(parsedJson));
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9_.-]*):\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
    if (match) {
      metrics[match[1]] = Number(match[2]);
    }
  }

  const metricNames = Array.isArray(contract?.metrics) ? contract.metrics.map((item) => String(item.name)) : [];
  if (contract?.primaryMetric) metricNames.push(String(contract.primaryMetric));
  for (const name of metricNames) {
    if (typeof metrics[name] !== "number") {
      continue;
    }
    if (!Number.isFinite(metrics[name])) {
      delete metrics[name];
    }
  }
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value)));
}

function collectNumericMetrics(target, payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.metrics && typeof payload.metrics === "object") {
    collectNumericMetrics(target, payload.metrics);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === "metrics") continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      target[key] = value;
    }
  }
}

function extractLastJson(text) {
  for (let index = text.lastIndexOf("{"); index >= 0; index = text.lastIndexOf("{", index - 1)) {
    for (let end = text.lastIndexOf("}"); end > index; end = text.lastIndexOf("}", end - 1)) {
      const candidate = text.slice(index, end + 1).trim();
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function readExperimentPlan(workspacePath) {
  const planPath = path.join(workspacePath, "AUTORESEARCH_EXPERIMENT.json");
  if (!fs.existsSync(planPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch {
    return null;
  }
}

async function recordSyntheticDryRunPatch(client, { runId, session, workspacePath }) {
  const result = await client.mutation(api.orchestration.recordPatch, {
    runId,
    workspacePath,
    changedFiles: ["AUTORESEARCH_DRY_RUN"],
    rejectedFiles: [],
    editablePaths: session.editablePaths,
    immutablePaths: session.immutablePaths,
    diff: "",
    diffStat: "",
    contentHash: "dry-run"
  });
  return result.patchId;
}

function collectPatch(workspacePath, session) {
  const entries = changedEntriesFromGit(workspacePath).filter((entry) => shouldIncludePatchFile(entry.file));
  const changedFiles = entries.map((entry) => entry.file);
  const rejectedFiles = changedFiles.filter((file) => !isEditable(file, session.editablePaths));
  const fullDiff = buildDiff(workspacePath, entries);
  const diffStat = buildDiffStat(workspacePath, entries);
  const contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(changedFiles))
    .update("\n")
    .update(fullDiff)
    .digest("hex");
  const rejectionReason =
    fullDiff.length > MAX_PATCH_DIFF_CHARS
      ? `Patch diff is too large for inline Convex storage (${fullDiff.length} chars).`
      : undefined;
  const diff = rejectionReason
    ? `${fullDiff.slice(0, MAX_PATCH_DIFF_CHARS)}\n\n[diff truncated because patch was rejected: ${rejectionReason}]\n`
    : fullDiff;
  return { changedFiles, rejectedFiles, diff, diffStat, contentHash, rejectionReason };
}

function shouldIncludePatchFile(file) {
  if (RUNNER_METADATA_FILES.has(file)) return false;
  return !isGeneratedArtifact(file);
}

function changedEntriesFromGit(workspacePath) {
  const status = gitOutput(["status", "--porcelain=v1", "-uall"], workspacePath);
  const entries = [];
  for (const line of status.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const statusCode = line.slice(0, 2);
    const raw = line.slice(3).trim();
    const file = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
    if (file) entries.push({ file: normalizeRelativePath(file), status: statusCode });
  }
  const byFile = new Map();
  for (const entry of entries) byFile.set(entry.file, entry);
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function buildDiff(workspacePath, entries) {
  if (entries.length === 0) return "";
  const tracked = entries.filter((entry) => entry.status !== "??").map((entry) => entry.file);
  const parts = [];
  if (tracked.length > 0) {
    parts.push(gitOutput(["diff", "--", ...tracked], workspacePath));
  }
  for (const entry of entries.filter((item) => item.status === "??")) {
    parts.push(untrackedFileDiff(workspacePath, entry.file));
  }
  return parts.filter(Boolean).join("\n");
}

function buildDiffStat(workspacePath, entries) {
  if (entries.length === 0) return "";
  const tracked = entries.filter((entry) => entry.status !== "??").map((entry) => entry.file);
  const parts = [];
  if (tracked.length > 0) {
    parts.push(gitOutput(["diff", "--stat", "--", ...tracked], workspacePath));
  }
  for (const entry of entries.filter((item) => item.status === "??")) {
    const absolutePath = path.join(workspacePath, entry.file);
    const lines = safeReadText(absolutePath).split(/\r?\n/).length;
    parts.push(` ${entry.file} | ${lines} +${"+".repeat(Math.min(lines, 60))}${lines > 60 ? "..." : ""}`);
  }
  return parts.filter(Boolean).join("\n");
}

function untrackedFileDiff(workspacePath, relativePath) {
  const absolutePath = path.join(workspacePath, relativePath);
  const content = safeReadText(absolutePath);
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${relativePath}`,
    "@@",
    ...content.split(/\r?\n/).map((line) => `+${line}`)
  ].join("\n");
}

function safeReadText(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return "[binary file omitted]";
  }
  return buffer.toString("utf8");
}

function gitOutput(args, cwd) {
  const result = spawnSync("git", args, { cwd, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function isEditable(file, editablePatterns) {
  const normalized = normalizeRelativePath(file);
  return editablePatterns.some((pattern) => globMatch(normalized, normalizeRelativePath(pattern)));
}

function globMatch(file, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(file);
}

function normalizeRelativePath(value) {
  return String(value).replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function shouldSkipCopy(source) {
  const parts = source.split(path.sep);
  return parts.includes(".git") || parts.includes("node_modules") || parts.includes(".venv") || parts.includes("dist") || isGeneratedArtifact(source);
}

function isGeneratedArtifact(file) {
  const normalized = normalizeRelativePath(file);
  const parts = normalized.split("/");
  if (parts.some((part) => GENERATED_ARTIFACT_PARTS.has(part))) {
    return true;
  }
  return GENERATED_ARTIFACT_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function runSync(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}`);
  }
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
  const normalized = String(value || "run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.slice(0, 64) || "run";
}

function shortId(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
