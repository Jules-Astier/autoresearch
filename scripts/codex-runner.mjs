#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostSessionStore, run as runSandcastle } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { vercel } from "@ai-hero/sandcastle/sandboxes/vercel";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import {
  createAgentProvider,
  resolveAgentEnv,
  resolveAgentRoleConfig
} from "./agent-providers.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".autoresearch", "runner");
const DEFAULT_COMPUTE_BUDGET_SECONDS = 300;
const RUNNER_METADATA_FILES = new Set([
  "AUTORESEARCH_PROMPT.md",
  "AUTORESEARCH_CODEX_FINAL.md",
  "AUTORESEARCH_EXPERIMENT.json",
  "AUTORESEARCH_MEMORY_KEEPER.md"
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
  ".aux",
  ".fdb_latexmk",
  ".fls",
  ".log",
  ".synctex.gz",
  ".tmp"
];
const MAX_PATCH_DIFF_CHARS = 750_000;
const MAX_ARTIFACT_BYTES = Number(process.env.AUTORESEARCH_MAX_ARTIFACT_BYTES ?? 900_000);
const TEX_BIN_DIR = "/Library/TeX/texbin";
const PDFTOPPM_RESOLUTIONS = [240, 180, 120];
const QUICKLOOK_SIZES = [1800, 1400, 1000];
const MODEL_DIAGRAM_SKILL_NAME = "$model-diagram-tikz";
const MODEL_DIAGRAM_SKILL_DIR = ".agents/skills/model-diagram-tikz";
const MODEL_DIAGRAM_SKILL_PATH = `${MODEL_DIAGRAM_SKILL_DIR}/SKILL.md`;
const DEFAULT_MODEL_DIAGRAM_SOURCE = "figures/model_architecture.tex";

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

  console.log(`Agent runner ${workerId} connected to ${convexUrl}`);
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

    const heartbeat = startRunHeartbeat(client, claim.runId);
    try {
      await runClaim(client, claim, args);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      await client.mutation(api.orchestration.failRun, {
        runId: claim.runId,
        error: message.slice(0, 4000),
        errorKind: classifyAgentError(message)
      });
    } finally {
      heartbeat.stop();
    }

    if (args.once) {
      return;
    }
  }
}

async function runClaim(client, claim, args) {
  const { session, basePatch, experiment, runId, priorExperiments } = claim;
  const workspacePath = prepareWorkspace({ session, basePatch, experiment, runId, args });
  const patchBaseRef = gitOutput(["rev-parse", "HEAD"], workspacePath).trim();
  const prompt = buildAgentPrompt({ session, basePatch, experiment, priorExperiments, workspacePath });
  const promptPath = path.join(workspacePath, "AUTORESEARCH_PROMPT.md");
  const finalPath = path.join(workspacePath, "AUTORESEARCH_CODEX_FINAL.md");
  const runnerConfig = resolveRunnerConfig(session, args);
  fs.writeFileSync(promptPath, prompt, "utf8");

  await client.mutation(api.orchestration.startRun, { runId, workspacePath });
  await client.mutation(api.orchestration.appendAgentMessage, {
    sessionId: session._id,
    experimentId: experiment._id,
    runId,
    role: "system",
    source: "agent-runner",
    sequence: 1,
    content: `Workspace prepared at ${workspacePath}`
  });

  if (args.dryRun) {
    await client.mutation(api.orchestration.appendAgentMessage, {
      sessionId: session._id,
      experimentId: experiment._id,
      runId,
      role: "assistant",
      source: "agent-runner",
      sequence: 2,
      content: "Dry run: skipped agent and benchmark execution."
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

  const agent =
    runnerConfig.backend === "sandcastle"
      ? await runAgentInSandcastle({
          client,
          session,
          experiment,
          runId,
          workspacePath,
          finalPath,
          prompt,
          config: runnerConfig
        })
      : await runAgentDirectly({
          client,
          runId,
          workspacePath,
          finalPath,
          prompt,
          config: runnerConfig
        });
  await recordAgentUsage(client, {
    sessionId: session._id,
    experimentId: experiment._id,
    runId,
    role: "worker",
    source: runnerConfig.agentProvider,
    provider: runnerConfig.agentProvider,
    model: runnerConfig.model,
    usage: agent.usage
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
      source: runnerConfig.agentProvider,
      sequence: 3,
      content: fs.readFileSync(finalPath, "utf8").slice(-12000)
    });
  }

  if (agent.code !== 0) {
    await failRunAndRemember(client, {
      runId,
      session,
      experiment,
      workspacePath,
      config: runnerConfig,
      baseRef: patchBaseRef,
      error: `${runnerConfig.agentProvider} exited with ${agent.code}`,
      codexExitCode: agent.code
    });
    return;
  }

  const patch = collectPatch(workspacePath, session, patchBaseRef);
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
    await failRunAndRemember(client, {
      runId,
      session,
      experiment,
      workspacePath,
      config: runnerConfig,
      baseRef: patchBaseRef,
      error: `${runnerConfig.agentProvider} completed without changing any tracked files`,
      codexExitCode: agent.code,
      patch: {
        changedFiles: patch.changedFiles,
        rejectedFiles: patch.rejectedFiles,
        diffStat: patch.diffStat,
        contentHash: patch.contentHash
      }
    });
    return;
  }

  if (patchResult.status !== "accepted") {
    await failRunAndRemember(client, {
      runId,
      session,
      experiment,
      workspacePath,
      config: runnerConfig,
      baseRef: patchBaseRef,
      error: patchResult.rejectionReason || "patch rejected",
      codexExitCode: agent.code,
      patch: {
        patchId: patchResult.patchId,
        status: patchResult.status,
        changedFiles: patch.changedFiles,
        rejectedFiles: patch.rejectedFiles,
        diffStat: patch.diffStat,
        contentHash: patch.contentHash,
        rejectionReason: patchResult.rejectionReason
      }
    });
    return;
  }

  try {
    await storeDiagramArtifacts({
      client,
      session,
      experiment,
      runId,
      workspacePath,
      changedFiles: patch.changedFiles
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRunAndRemember(client, {
      runId,
      session,
      experiment,
      workspacePath,
      config: runnerConfig,
      baseRef: patchBaseRef,
      error: message.slice(0, 4000),
      codexExitCode: agent.code,
      patch: {
        patchId: patchResult.patchId,
        status: patchResult.status,
        changedFiles: patch.changedFiles,
        rejectedFiles: patch.rejectedFiles,
        diffStat: patch.diffStat,
        contentHash: patch.contentHash
      }
    });
    return;
  }

  const benchmark =
    runnerConfig.backend === "sandcastle"
      ? await runBenchmarkInSandcastle({ client, session, experiment, runId, workspacePath, config: runnerConfig })
      : await runProcess({
          client,
          runId,
          cwd: workspacePath,
          command: session.benchmarkCommand,
          shell: true,
          env: {
            AUTORESEARCH_COMPUTE_BUDGET_SECONDS: String(runnerConfig.computeBudgetSeconds)
          },
          timeoutMs: runnerConfig.computeBudgetSeconds * 1000,
          stdoutStream: "benchmark_stdout",
          stderrStream: "benchmark_stderr"
        });
  const summaryText = [benchmark.stdout, benchmark.stderr].join("\n");
  const metrics = parseMetrics(summaryText, session.metricContract);

  if (Object.keys(metrics).length === 0) {
    await failRunAndRemember(client, {
      runId,
      session,
      experiment,
      workspacePath,
      config: runnerConfig,
      baseRef: patchBaseRef,
      error: "benchmark completed without parseable numeric metrics",
      codexExitCode: agent.code,
      benchmarkExitCode: benchmark.code,
      summary: summaryText.slice(-4000),
      patch: {
        patchId: patchResult.patchId,
        status: patchResult.status,
        changedFiles: patch.changedFiles,
        rejectedFiles: patch.rejectedFiles,
        diffStat: patch.diffStat,
        contentHash: patch.contentHash
      }
    });
    return;
  }

  const completion = await client.mutation(api.orchestration.completeRun, {
    runId,
    patchId: patchResult.patchId,
    codexExitCode: agent.code,
    benchmarkExitCode: benchmark.code,
    metrics,
    summary: extractLastJson(summaryText) ?? summaryText.slice(-4000)
  });
  await maybeRunMemoryKeeper({
    client,
    runId,
    session,
    experiment,
    workspacePath,
    config: runnerConfig,
    outcome: {
      status: completion?.status ?? (benchmark.code === 0 ? "completed" : "failed"),
      baseRef: patchBaseRef,
      metrics,
      score: completion?.score,
      promoted: completion?.promoted === true,
      codexExitCode: agent.code,
      benchmarkExitCode: benchmark.code,
      summary: extractLastJson(summaryText) ?? summaryText.slice(-4000)
    },
    patch: {
      patchId: patchResult.patchId,
      status: patchResult.status,
      changedFiles: patch.changedFiles,
      rejectedFiles: patch.rejectedFiles,
      diffStat: patch.diffStat,
      contentHash: patch.contentHash
    }
  });
}

function startRunHeartbeat(client, runId) {
  let stopped = false;
  const beat = () => {
    if (stopped) return;
    client
      .mutation(api.orchestration.heartbeatRun, { runId })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`failed to heartbeat run ${runId}: ${message}`);
      });
  };
  beat();
  const timer = setInterval(beat, 15000);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

async function failRunAndRemember(client, {
  runId,
  session,
  experiment,
  workspacePath,
  config,
  baseRef,
  error,
  codexExitCode,
  benchmarkExitCode,
  summary,
  patch
}) {
  await client.mutation(api.orchestration.failRun, {
    runId,
    error,
    errorKind: classifyAgentError(error),
    codexExitCode,
    benchmarkExitCode
  });
  await maybeRunMemoryKeeper({
    client,
    runId,
    session,
    experiment,
    workspacePath,
    config,
    outcome: {
      status: "failed",
      baseRef,
      error,
      codexExitCode,
      benchmarkExitCode,
      summary
    },
    patch
  });
}

function classifyAgentError(value) {
  const text = String(value ?? "").toLowerCase();
  if (/\b(401|403|unauthorized|forbidden|auth|api key|credential|permission denied|not logged in|login required|invalid api key|missing api key|config error|configuration error|misconfigured)\b/u.test(text)) {
    return "auth/config_error";
  }
  if (/\b(429|rate limit|rate_limit|too many requests|quota|insufficient_quota|usage limit|credit|billing|out of credits)\b/u.test(text)) {
    return "quota_exhausted";
  }
  if (/\b(503|502|504|unavailable|overloaded|capacity|temporarily unavailable|try again later)\b/u.test(text)) {
    return "transient_agent_unavailable";
  }
  if (/\b(timeout|timed out|idle timeout|deadline|etimedout|econnreset|network)\b/u.test(text)) {
    return "transient_agent_unavailable";
  }
  return "agent_failed_task";
}

async function maybeRunMemoryKeeper({
  client,
  runId,
  session,
  experiment,
  workspacePath,
  config,
  outcome,
  patch
}) {
  const memory = normalizeMemoryConfig(session.memory);
  if (!memory || memory.enabled === false || memory.memoryKeeper?.enabled === false) {
    return;
  }

  const repoPath = path.resolve(ROOT, session.repoPath);
  if (!fs.existsSync(repoPath)) {
    await appendMemoryKeeperLog(client, runId, `memory keeper skipped: repoPath does not exist: ${repoPath}\n`);
    return;
  }

  try {
    await withDirectoryLock(path.join(repoPath, ".autoresearch-memory.lock"), async () => {
      prepareMemoryPaths(repoPath, memory);
      const prompt = buildMemoryKeeperPrompt({ session, experiment, outcome, patch, memory });
      const finalPath = path.join(workspacePath, "AUTORESEARCH_MEMORY_KEEPER.md");
      const memoryKeeperAgent = resolveRunnerAgentConfig(session, config.runnerArgs ?? {}, config.rawSandbox ?? {}, "memoryKeeper");
      const memoryKeeperConfig = {
        ...memoryKeeperAgent,
        env: resolveSandcastleEnv(config.rawSandbox ?? {}, memoryKeeperAgent.env)
      };
      const provider = createAgentProvider(memoryKeeperConfig);
      const printCommand = provider.buildPrintCommand({
        prompt,
        dangerouslySkipPermissions: true
      });
      const result = await runAgentProviderCommand({
        client,
        runId,
        cwd: repoPath,
        command: printCommand.command,
        input: printCommand.stdin,
        env: provider.env,
        provider,
        stdoutStream: "memory_keeper_stdout",
        stderrStream: "memory_keeper_stderr"
      });
      const final = result.result || result.stdout || "";
      fs.writeFileSync(finalPath, final, "utf8");
      await recordAgentUsage(client, {
        sessionId: session._id,
        experimentId: experiment._id,
        runId,
        role: "memoryKeeper",
        source: "memory_keeper",
        provider: memoryKeeperConfig.agentProvider,
        model: memoryKeeperConfig.model,
        usage: result.usage
      });
      await client.mutation(api.orchestration.appendAgentMessage, {
        sessionId: session._id,
        experimentId: experiment._id,
        runId,
        role: "assistant",
        source: "memory_keeper",
        sequence: Date.now(),
        content: final.slice(-12000) || `memory keeper exited with ${result.code}`
      });
      if (result.code !== 0) {
        await appendMemoryKeeperLog(client, runId, `memory keeper exited with ${result.code}\n`);
      }
      try {
        const notes = snapshotMemoryNotes(repoPath, memory);
        if (notes.length > 0) {
          await client.mutation(api.orchestration.recordMemoryNotes, {
            sessionId: session._id,
            runId,
            notes
          });
        }
      } catch (snapshotError) {
        const message = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
        await appendMemoryKeeperLog(client, runId, `memory snapshot failed: ${message}\n`);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendMemoryKeeperLog(client, runId, `memory keeper failed: ${message}\n`);
  }
}

function snapshotMemoryNotes(repoPath, memory) {
  const paths = [
    memory.notesPath,
    memory.doNotRepeatPath,
    memory.paperIdeasPath,
    memory.campaignsPath,
    memory.experimentsPath,
    memory.templatesPath,
    ...(memory.referencePaths ?? [])
  ];
  const seen = new Set();
  const notes = [];
  for (const relativePath of paths) {
    if (!relativePath || seen.has(relativePath)) continue;
    seen.add(relativePath);
    const absolute = safeResolveRepoPath(repoPath, relativePath);
    if (!fs.existsSync(absolute)) {
      notes.push({ path: relativePath, kind: "missing" });
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch (error) {
      continue;
    }
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(absolute, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .sort()
        .slice(0, 50);
      notes.push({ path: relativePath, kind: "directory", entries });
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || !entry.isFile()) continue;
        const childRelative = path.posix.join(relativePath, entry.name);
        const childAbsolute = path.join(absolute, entry.name);
        const note = readMemoryFileNote(childRelative, childAbsolute);
        if (note) notes.push(note);
      }
    } else if (stat.isFile()) {
      const note = readMemoryFileNote(relativePath, absolute);
      if (note) notes.push(note);
    }
  }
  return notes;
}

function readMemoryFileNote(relativePath, absolutePath) {
  try {
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) return null;
    const text = buffer.toString("utf8");
    const truncated = text.length > 32000 ? text.slice(-32000) : text;
    const contentHash = crypto.createHash("sha256").update(truncated).digest("hex");
    return {
      path: relativePath,
      kind: "file",
      content: truncated,
      byteLength: buffer.byteLength,
      contentHash
    };
  } catch (error) {
    return { path: relativePath, kind: "error" };
  }
}

function buildMemoryKeeperPrompt({ session, experiment, outcome, patch, memory }) {
  return `You are the memory keeper for this Autoresearch session.

Update durable research memory in the target repo after this run. Keep notes concise, factual, and comparable across runs.

Primary memory paths:
${formatMemoryPaths(memory)}

Session:
${JSON.stringify({
  title: session.title,
  slug: session.slug,
  benchmarkCommand: session.benchmarkCommand,
  metricContract: session.metricContract,
  bestMetrics: session.bestMetrics
}, null, 2)}

Experiment:
${JSON.stringify({
  ordinal: experiment.ordinal,
  hypothesis: experiment.hypothesis,
  changeKind: experiment.changeKind,
  prompt: experiment.prompt
}, null, 2)}

Run outcome:
${JSON.stringify(outcome ?? {}, null, 2)}

Patch:
${JSON.stringify(patch ?? {}, null, 2)}

Responsibilities:
- Preserve the hypothesis tested, parent/base reference when available, metric values or failure state, current-best decision, and one short interpretation.
- Turn regressions, invalid runs, patch rejections, and duplicate discoveries into concise do-not-repeat guidance.
- Summarize wins and near misses without rewriting history.
- Keep campaign and experiment notes current when the configured paths exist.

Rules:
- Edit only files under the configured memory paths.
- Do not edit source code, benchmarks, data, generated artifacts, credentials, or deployment files.
- Do not run benchmark commands.
- Do not delete useful historical failures.
- Create missing memory files or directories when needed.
${memory.memoryKeeper?.instructions ? `\nAdditional memory keeper instructions:\n${memory.memoryKeeper.instructions}` : ""}

Final response must summarize which memory files changed and the durable note added.`;
}

function formatMemoryPaths(memory) {
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

function prepareMemoryPaths(repoPath, memory) {
  for (const relativePath of [
    path.posix.dirname(memory.notesPath),
    path.posix.dirname(memory.doNotRepeatPath),
    path.posix.dirname(memory.paperIdeasPath),
    memory.campaignsPath,
    memory.experimentsPath,
    memory.templatesPath
  ]) {
    fs.mkdirSync(safeResolveRepoPath(repoPath, relativePath), { recursive: true });
  }
}

async function appendMemoryKeeperLog(client, runId, chunk) {
  try {
    await client.mutation(api.orchestration.appendRunLog, {
      runId,
      stream: "memory_keeper_stderr",
      sequence: Date.now(),
      chunk: String(chunk).slice(-8000)
    });
  } catch (error) {
    console.error("failed to append memory keeper log:", error);
  }
}

async function withDirectoryLock(lockPath, fn) {
  const timeoutMs = Number(process.env.AUTORESEARCH_MEMORY_LOCK_TIMEOUT_MS ?? 120000);
  const startedAt = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, "owner"), `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for memory keeper lock: ${lockPath}`);
      }
      await sleep(500);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
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
  applyWorkspaceLinks(destination, session.workspaceLinks);
  applyBasePatch(destination, basePatch);
  if (isArchitectureChange(experiment)) {
    installModelDiagramSkill(destination);
  }
  return destination;
}

export function applyWorkspaceLinks(workspacePath, links) {
  for (const link of normalizeWorkspaceLinks(links)) {
    const linkPath = safeResolveWorkspacePath(workspacePath, link.workspacePath);
    const targetPath = path.resolve(link.targetPath);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`workspace link target does not exist: ${targetPath}`);
    }
    const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
    if (existing) {
      if (existing.isSymbolicLink() && path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)) === targetPath) {
        continue;
      }
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    const targetStat = fs.statSync(targetPath);
    const type = targetStat.isDirectory()
      ? process.platform === "win32" ? "junction" : "dir"
      : "file";
    fs.symlinkSync(targetPath, linkPath, type);
  }
}

function normalizeWorkspaceLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .filter((link) => isPlainObject(link))
    .map((link) => ({
      workspacePath: normalizeRelativePath(link.workspacePath),
      targetPath: String(link.targetPath || "")
    }))
    .filter((link) => link.workspacePath && link.targetPath);
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

export function buildAgentPrompt({ session, basePatch, experiment, priorExperiments, workspacePath }) {
  const experimentPrompt = String(experiment.prompt || "").trim();
  const architectureDiagramInstructions = buildArchitectureDiagramInstructions({
    session,
    experiment,
    workspacePath
  });
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
- Benchmark compute budget: ${resolveComputeBudgetSeconds(session.computeBudget)} seconds
- Target experiments: ${session.targetExperimentCount}
- Objective priority contract:
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

Worker instruction:
${experimentPrompt || "- none provided; use the queued hypothesis as the worker instruction."}

Rules:
- Make exactly one coherent research change.
- You may make PyTorch architecture changes if model inputs and outputs stay compatible.
- You may make runtime config or hyperparameter changes in declared config files.
${architectureDiagramInstructions}
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

function installModelDiagramSkill(workspacePath) {
  const sourceDir = path.join(ROOT, ".agents", "skills", "model-diagram-tikz");
  const targetDir = path.join(workspacePath, ".agents", "skills", "model-diagram-tikz");
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Model diagram skill is missing from Autoresearch: ${sourceDir}`);
  }
  if (fs.existsSync(targetDir)) {
    return;
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  runSync("git", ["add", MODEL_DIAGRAM_SKILL_DIR], workspacePath);
  const staged = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: workspacePath,
    stdio: "ignore"
  });
  if (staged.status === 1) {
    runSync(
      "git",
      [
        "-c",
        "user.email=autoresearch@example.local",
        "-c",
        "user.name=Autoresearch Runner",
        "commit",
        "-m",
        "autoresearch model diagram skill"
      ],
      workspacePath
    );
  } else if (staged.status !== 0) {
    throw new Error("git diff --cached --quiet failed while installing model diagram skill");
  }
}

function buildArchitectureDiagramInstructions({ session, experiment, workspacePath }) {
  if (!isArchitectureChange(experiment)) {
    return "- For config_change work, do not create or edit model architecture diagrams unless the queued worker instruction explicitly asks for it.";
  }

  const existingSources = listExistingEditableTikzSources(workspacePath, session.editablePaths);
  const creationTarget = preferredDiagramCreationTarget(session.editablePaths);
  const sourceList = existingSources.length > 0
    ? existingSources.map((item) => `  - ${item}`).join("\n")
    : "  - none found";
  const targetLine = creationTarget
    ? `- If no editable diagram source already exists, create ${creationTarget} as a standalone TikZ/LaTeX source.`
    : "- If no editable diagram source already exists, create one only if you can place it under an editable `.tex` path; otherwise stop and explain that the session needs an editable diagram path such as `figures/**/*.tex`.";

  return `- This architecture_change is allowed to modify the model architecture, so directly use ${MODEL_DIAGRAM_SKILL_NAME}; read ${MODEL_DIAGRAM_SKILL_PATH} before editing or creating the diagram source.
- For the diagram work, create or update only the standalone TikZ \`.tex\` source for this same architecture change.
- When the diagram uses math notation, include the required standard packages in the source, for example \`\\usepackage{amsfonts}\` or \`\\usepackage{amssymb}\` for \`\\mathbb\`.
- Existing editable TikZ sources:
${sourceList}
${targetLine}
- Include the changed \`.tex\` source in AUTORESEARCH_EXPERIMENT.json changedFiles.
- Do not run LaTeX, call PDF/PNG export tools, or create rendered diagram PDFs or PNGs. The local runner compiles changed TikZ \`.tex\` sources and stores only the PNG artifact after the patch is accepted.`;
}

function listExistingEditableTikzSources(workspacePath, editablePaths) {
  let files = [];
  try {
    files = gitOutput(["ls-files", "*.tex"], workspacePath)
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
  return files
    .filter((file) => isEditable(file, editablePaths))
    .filter((file) => isTikzSource(workspacePath, file))
    .sort((a, b) => a.localeCompare(b));
}

function preferredDiagramCreationTarget(editablePaths) {
  if (isEditable(DEFAULT_MODEL_DIAGRAM_SOURCE, editablePaths)) {
    return DEFAULT_MODEL_DIAGRAM_SOURCE;
  }
  for (const pattern of editablePaths ?? []) {
    const normalized = normalizeRelativePath(pattern);
    const lower = normalized.toLowerCase();
    if (lower.endsWith(".tex") && !normalized.includes("*")) {
      return normalized;
    }
    if (normalized.includes("*") && isEditable(DEFAULT_MODEL_DIAGRAM_SOURCE, [normalized])) {
      return DEFAULT_MODEL_DIAGRAM_SOURCE;
    }
    const directoryMatch = normalized.match(/^(.*?)(?:\/\*\*\/\*\.tex|\/\*\.tex)$/iu);
    if (directoryMatch) {
      return `${directoryMatch[1] || "figures"}/model_architecture.tex`;
    }
    if (lower.endsWith("/**") && isEditable(`${normalized.slice(0, -3)}/model_architecture.tex`, [normalized])) {
      return `${normalized.slice(0, -3)}/model_architecture.tex`;
    }
  }
  return null;
}

async function runAgentDirectly({ client, runId, workspacePath, finalPath, prompt, config }) {
  const provider = createAgentProvider(config);
  const printCommand = provider.buildPrintCommand({
    prompt,
    dangerouslySkipPermissions: true
  });
  const result = await runAgentProviderCommand({
    client,
    runId,
    cwd: workspacePath,
    command: printCommand.command,
    input: printCommand.stdin,
    env: provider.env,
    provider,
    stdoutStream: "agent_stdout",
    stderrStream: "agent_stderr"
  });
  fs.writeFileSync(finalPath, result.result || result.stdout || "", "utf8");
  return {
    code: result.code,
    stdout: result.result || result.stdout || "",
    stderr: result.stderr,
    usage: result.usage
  };
}

async function runAgentInSandcastle({
  client,
  experiment,
  runId,
  workspacePath,
  finalPath,
  prompt,
  config
}) {
  const pendingLogs = [];
  let result;
  try {
    result = await runSandcastle({
      cwd: workspacePath,
      branchStrategy: sandcastleBranchStrategy(config),
      sandbox: createSandcastleSandboxProvider(config),
      agent: createAgentProvider(config),
      prompt,
      maxIterations: config.maxIterations,
      completionSignal: config.completionSignal,
      idleTimeoutSeconds: config.idleTimeoutSeconds,
      hooks: createSandcastleHooks(config),
      name: `experiment-${experiment.ordinal}`,
      logging: {
        type: "file",
        path: sandcastleLogPath(workspacePath, "agent"),
        onAgentStreamEvent: createSandcastleLogForwarder({
          client,
          runId,
          stream: "agent_stdout",
          pendingLogs
        })
      }
    });
  } finally {
    await Promise.allSettled(pendingLogs);
  }
  fs.writeFileSync(finalPath, result.stdout ?? "", "utf8");
  return {
    code: 0,
    stdout: result.stdout ?? "",
    stderr: "",
    logFilePath: result.logFilePath,
    usage: combineUsage((result.iterations ?? []).map((iteration) => iteration.usage))
  };
}

async function runBenchmarkInSandcastle({ client, session, experiment, runId, workspacePath, config }) {
  const pendingLogs = [];
  let result;
  try {
    result = await runSandcastle({
      cwd: workspacePath,
      branchStrategy: sandcastleBranchStrategy(config),
      sandbox: createSandcastleSandboxProvider(config),
      agent: createBenchmarkAgent(session.benchmarkCommand, config),
      prompt: `Run the benchmark command for Autoresearch experiment #${experiment.ordinal}.`,
      maxIterations: 1,
      completionSignal: "__AUTORESEARCH_EXIT_CODE__:",
      idleTimeoutSeconds: config.computeBudgetSeconds + 30,
      hooks: createSandcastleHooks(config),
      name: `benchmark-${experiment.ordinal}`,
      logging: {
        type: "file",
        path: sandcastleLogPath(workspacePath, "benchmark"),
        onAgentStreamEvent: createSandcastleLogForwarder({
          client,
          runId,
          stream: "benchmark_stdout",
          pendingLogs
        })
      }
    });
  } finally {
    await Promise.allSettled(pendingLogs);
  }
  const stdout = result.stdout ?? "";
  const code = parseBenchmarkExitCode(stdout);
  return {
    code,
    stdout: stripBenchmarkExitCode(stdout),
    stderr: "",
    logFilePath: result.logFilePath
  };
}

function resolveRunnerBackend(session, args) {
  const sandboxConfig = isPlainObject(session.sandbox) ? session.sandbox : {};
  const environment = resolveSandboxEnvironment(session, args);
  if (environment !== "none") {
    return "sandcastle";
  }
  const configured =
    args.runnerBackend ??
    args.backend ??
    process.env.AUTORESEARCH_RUNNER_BACKEND ??
    sandboxConfig.backend;
  return String(configured ?? "direct").trim().toLowerCase() === "sandcastle"
    ? "sandcastle"
    : "direct";
}

function resolveSandboxEnvironment(session, args) {
  const sandboxConfig = isPlainObject(session.sandbox) ? session.sandbox : {};
  const configured =
    args.sandboxEnvironment ??
    args.sandbox ??
    args.sandcastleProvider ??
    args.backend ??
    process.env.AUTORESEARCH_SANDBOX_ENVIRONMENT ??
    process.env.AUTORESEARCH_SANDCASTLE_PROVIDER ??
    sandboxConfig.environment ??
    sandboxConfig.provider ??
    sandboxConfig.backend;
  if (!configured) {
    return sandboxConfig.enabled === true ? "docker" : "none";
  }
  const environment = String(configured).trim().toLowerCase();
  if (environment === "local" || environment === "direct") return "none";
  if (environment === "sandcastle") return String(sandboxConfig.provider ?? "docker").trim().toLowerCase();
  if (environment === "none" || environment === "docker" || environment === "podman" || environment === "vercel") {
    return environment;
  }
  throw new Error(`Unsupported sandbox environment: ${environment}`);
}

function resolveRunnerConfig(session, args) {
  const raw = isPlainObject(session.sandbox) ? session.sandbox : {};
  const workerAgent = resolveRunnerAgentConfig(session, args, raw, "worker");
  const workerEnv = resolveSandcastleEnv(raw, workerAgent.env);
  const repoName = path.basename(path.resolve(session.repoPath));
  const computeBudgetSeconds = resolveComputeBudgetSeconds(session.computeBudget);
  const environment = resolveSandboxEnvironment(session, args);
  return {
    backend: resolveRunnerBackend(session, args),
    environment,
    provider: environment === "none" ? undefined : environment,
    rawSandbox: raw,
    imageName: stringOption(
      args.sandcastleImage,
      process.env.AUTORESEARCH_SANDCASTLE_IMAGE,
      raw.imageName,
      defaultSandcastleImageName(repoName)
    ),
    network: stringOrStringArray(raw.network),
    mounts: normalizeSandcastleMounts(raw.mounts),
    env: workerEnv,
    setupCommands: normalizeCommandList(raw.setupCommands, raw.setupCommand),
    setupTimeoutMs: positiveNumber(raw.setupTimeoutMs),
    agentProvider: workerAgent.agentProvider,
    model: workerAgent.model,
    effort: workerAgent.effort,
    agentConfigs: {
      worker: { ...workerAgent, env: workerEnv }
    },
    runnerArgs: args,
    maxIterations: positiveInteger(raw.maxIterations, 1),
    completionSignal: optionalStringValue(raw.completionSignal),
    idleTimeoutSeconds: positiveInteger(raw.idleTimeoutSeconds, 600),
    computeBudgetSeconds
  };
}

function resolveRunnerAgentConfig(session, args, raw, role) {
  return resolveAgentRoleConfig({
    role,
    sessionAgent: session.agent,
    sandboxAgent: raw.agent,
    args,
    providerOverrides: [
      args.agentProvider,
      args.agent,
      process.env.AUTORESEARCH_AGENT_PROVIDER
    ],
    modelOverrides: [
      args.agentModel,
      args.model,
      process.env.AUTORESEARCH_AGENT_MODEL,
      args.sandcastleModel,
      process.env.AUTORESEARCH_SANDCASTLE_MODEL,
      process.env.AUTORESEARCH_CODEX_MODEL
    ],
    effortOverrides: [
      args.agentEffort,
      args.effort,
      process.env.AUTORESEARCH_AGENT_EFFORT,
      args.sandcastleEffort,
      process.env.AUTORESEARCH_SANDCASTLE_EFFORT
    ],
    providerFallbacks: [raw.agentProvider]
  });
}

function resolveComputeBudgetSeconds(value) {
  if (isPlainObject(value)) {
    return positiveInteger(
      value.seconds ??
        value.durationSeconds ??
        value.benchmarkSeconds ??
        value.benchmarkTimeoutSeconds,
      DEFAULT_COMPUTE_BUDGET_SECONDS
    );
  }
  if (value !== undefined && value !== null && value !== "") {
    return positiveInteger(value, DEFAULT_COMPUTE_BUDGET_SECONDS);
  }
  return DEFAULT_COMPUTE_BUDGET_SECONDS;
}

function createSandcastleSandboxProvider(config) {
  if (config.environment === "vercel") {
    return vercel({
      token: optionalStringValue(config.rawSandbox?.token),
      source: config.rawSandbox?.source,
      ports: config.rawSandbox?.ports,
      timeout: positiveNumber(config.rawSandbox?.timeout),
      resources: config.rawSandbox?.resources,
      runtime: optionalStringValue(config.rawSandbox?.runtime),
      networkPolicy: config.rawSandbox?.networkPolicy,
      projectId: optionalStringValue(config.rawSandbox?.projectId),
      teamId: optionalStringValue(config.rawSandbox?.teamId),
      timeoutMs: positiveNumber(config.rawSandbox?.timeoutMs),
      template: optionalStringValue(config.rawSandbox?.template),
      env: config.env
    });
  }

  const options = {
    imageName: config.imageName,
    mounts: config.mounts,
    env: config.env,
    network: config.network
  };
  if (config.environment === "docker") {
    return docker(options);
  }
  if (config.environment === "podman") {
    return podman({
      ...options,
      selinuxLabel: config.rawSandbox?.selinuxLabel,
      userns: config.rawSandbox?.userns,
      containerUid: config.rawSandbox?.containerUid,
      containerGid: config.rawSandbox?.containerGid
    });
  }
  throw new Error(`Unsupported Sandcastle environment: ${config.environment}`);
}

function sandcastleBranchStrategy(config) {
  return config.environment === "vercel" ? { type: "merge-to-head" } : { type: "head" };
}

function createBenchmarkAgent(command, config) {
  const timeoutFile = ".autoresearch_benchmark_timeout";
  const script = `(
${command}
) 2>&1 &
benchmark_pid=$!
rm -f ${timeoutFile}
(
  sleep ${config.computeBudgetSeconds}
  printf 'timeout\\n' > ${timeoutFile}
  kill -TERM "$benchmark_pid" 2>/dev/null || true
  sleep 5
  kill -KILL "$benchmark_pid" 2>/dev/null || true
) &
watchdog_pid=$!
wait "$benchmark_pid"
code=$?
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true
if [ -s ${timeoutFile} ]; then
  printf '\\nBenchmark timed out after ${config.computeBudgetSeconds} seconds.\\n' >&2
  code=124
fi
rm -f ${timeoutFile}
printf '\\n__AUTORESEARCH_EXIT_CODE__:%s\\n' "$code"
exit 0`;
  return {
    name: "benchmark",
    env: {
      ...config.env,
      AUTORESEARCH_COMPUTE_BUDGET_SECONDS: String(config.computeBudgetSeconds)
    },
    captureSessions: false,
    buildPrintCommand() {
      return { command: `sh -lc ${shellEscape(script)}` };
    },
    parseStreamLine(line) {
      return [{ type: "text", text: `${line}\n` }];
    }
  };
}

function createSandcastleHooks(config) {
  if (config.setupCommands.length === 0) {
    return undefined;
  }
  return {
    sandbox: {
      onSandboxReady: config.setupCommands.map((command) => ({
        command,
        timeoutMs: config.setupTimeoutMs
      }))
    }
  };
}

function createSandcastleLogForwarder({ client, runId, stream, pendingLogs }) {
  let sequence = Date.now();
  return (event) => {
    const chunk =
      event.type === "toolCall"
        ? `[tool:${event.name}] ${event.formattedArgs}\n`
        : String(event.message ?? "");
    if (!chunk) return;
    process[stream.includes("stderr") ? "stderr" : "stdout"].write(chunk);
    sequence += 1;
    pendingLogs.push(
      client
        .mutation(api.orchestration.appendRunLog, {
          runId,
          stream,
          sequence,
          chunk: chunk.slice(-8000)
        })
        .catch((error) => {
          console.error(`failed to append ${stream}:`, error);
        })
    );
  };
}

function sandcastleLogPath(workspacePath, kind) {
  return path.join(path.dirname(workspacePath), `${path.basename(workspacePath)}-${kind}.sandcastle.log`);
}

function parseBenchmarkExitCode(text) {
  const matches = [...text.matchAll(/^__AUTORESEARCH_EXIT_CODE__:(\d+)$/gm)];
  if (matches.length === 0) {
    return 1;
  }
  return Number(matches.at(-1)[1]);
}

function stripBenchmarkExitCode(text) {
  return text.replace(/^__AUTORESEARCH_EXIT_CODE__:\d+\r?\n?/gm, "");
}

function defaultSandcastleImageName(repoName) {
  const normalized = String(repoName || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `sandcastle:${normalized || "workspace"}`;
}

function resolveSandcastleEnv(raw, agentEnv) {
  return {
    ...resolveAgentEnv(raw),
    ...agentEnv
  };
}

function normalizeSandcastleMounts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new Error(`sandbox.mounts[${index}] must be an object`);
    }
    const hostPath = optionalStringValue(item.hostPath);
    const sandboxPath = optionalStringValue(item.sandboxPath);
    if (!hostPath || !sandboxPath) {
      throw new Error(`sandbox.mounts[${index}] requires hostPath and sandboxPath`);
    }
    return {
      hostPath,
      sandboxPath,
      readonly: item.readonly === true
    };
  });
}

function normalizeCommandList(list, single) {
  const commands = [];
  if (single) commands.push(String(single));
  if (Array.isArray(list)) {
    commands.push(...list.map((item) => String(item)));
  }
  return commands.map((item) => item.trim()).filter(Boolean);
}

function stringOption(...values) {
  for (const value of values) {
    const stringValue = optionalStringValue(value);
    if (stringValue) return stringValue;
  }
  return "";
}

function optionalStringValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    return String(value).trim();
  }
  return undefined;
}

function stringOrStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return optionalStringValue(value);
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function positiveNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, got ${value}`);
  }
  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function runAgentProviderCommand({
  client,
  runId,
  cwd,
  command,
  input,
  env,
  provider,
  stdoutStream,
  stderrStream
}) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let sequence = Date.now();
    let stdout = "";
    let stderr = "";
    let result = "";
    let sessionId;
    let stdoutLineBuffer = "";
    const usageSnapshots = [];
    const pendingLogs = [];

    const append = (stream, text) => {
      if (!text) return;
      process[stream.includes("stderr") ? "stderr" : "stdout"].write(text);
      sequence += 1;
      pendingLogs.push(
        client
          .mutation(api.orchestration.appendRunLog, {
            runId,
            stream,
            sequence,
            chunk: text.slice(-8000)
          })
          .catch((error) => {
            console.error(`failed to append ${stream}:`, error);
          })
      );
    };

    const emitParsedLine = (line) => {
      const usage = parseUsageFromJsonLine(line);
      if (usage) usageSnapshots.push(usage);
      const parsed = provider.parseStreamLine(line);
      if (parsed.length === 0) {
        if (line.trim()) append(stdoutStream, `${line}\n`);
        return;
      }
      for (const event of parsed) {
        if (event.type === "text") {
          append(stdoutStream, event.text);
        } else if (event.type === "result") {
          result = event.result;
        } else if (event.type === "tool_call") {
          append(stdoutStream, `[tool:${event.name}] ${event.args}\n`);
        } else if (event.type === "session_id") {
          sessionId = event.sessionId;
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
      append(stderrStream, text);
    });
    child.on("error", (error) => {
      stderr += String(error);
    });
    child.on("close", async (code) => {
      if (stdoutLineBuffer) {
        emitParsedLine(stdoutLineBuffer);
      }
      await Promise.allSettled(pendingLogs);
      const sessionUsage = await readProviderSessionUsage({ provider, cwd, sessionId });
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        result,
        usage: combineUsage([...usageSnapshots, sessionUsage])
      });
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function readProviderSessionUsage({ provider, cwd, sessionId }) {
  if (!provider.captureSessions || !provider.parseSessionUsage || !sessionId) {
    return null;
  }
  try {
    const content = await hostSessionStore(cwd).readSession(sessionId);
    return provider.parseSessionUsage(content) ?? null;
  } catch {
    return null;
  }
}

async function recordAgentUsage(client, {
  sessionId,
  experimentId,
  runId,
  role,
  source,
  provider,
  model,
  usage
}) {
  if (!usage) return;
  await client.mutation(api.orchestration.recordAgentUsage, {
    ...definedFields({
      sessionId,
      experimentId,
      runId,
      role,
      source,
      provider,
      model
    }),
    ...definedFields(usage)
  });
}

function combineUsage(items) {
  const normalized = items.map(normalizeUsage).filter(Boolean);
  if (normalized.length === 0) return null;
  return normalized.reduce((total, usage) => ({
    inputTokens: addOptional(total.inputTokens, usage.inputTokens),
    cacheCreationInputTokens: addOptional(total.cacheCreationInputTokens, usage.cacheCreationInputTokens),
    cacheReadInputTokens: addOptional(total.cacheReadInputTokens, usage.cacheReadInputTokens),
    outputTokens: addOptional(total.outputTokens, usage.outputTokens),
    totalTokens: addOptional(total.totalTokens, usage.totalTokens),
    rawUsage: [...(total.rawUsage ?? []), usage.rawUsage ?? usage]
  }), {});
}

function normalizeUsage(value) {
  if (!isPlainObject(value)) return null;
  const raw = isPlainObject(value.usage) ? value.usage : value;
  const inputTokens = numberOption(raw.inputTokens, raw.input_tokens, raw.promptTokens, raw.prompt_tokens);
  const cacheCreationInputTokens = numberOption(raw.cacheCreationInputTokens, raw.cache_creation_input_tokens);
  const cacheReadInputTokens = numberOption(raw.cacheReadInputTokens, raw.cache_read_input_tokens);
  const outputTokens = numberOption(raw.outputTokens, raw.output_tokens, raw.completionTokens, raw.completion_tokens);
  const totalTokens = numberOption(raw.totalTokens, raw.total_tokens);
  if ([inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens, totalTokens].every((item) => item === undefined)) {
    return null;
  }
  return { inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens, totalTokens, rawUsage: raw };
}

function parseUsageFromJsonLine(line) {
  if (!line.startsWith("{")) return null;
  try {
    return findUsageObject(JSON.parse(line));
  } catch {
    return null;
  }
}

function findUsageObject(value) {
  if (!isPlainObject(value)) return null;
  if (normalizeUsage(value)) return value;
  for (const key of ["usage", "token_usage", "tokenUsage", "response", "message", "item"]) {
    const found = findUsageObject(value[key]);
    if (found) return found;
  }
  return null;
}

function numberOption(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function addOptional(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + b;
}

function definedFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}

async function runProcess({
  client,
  runId,
  cwd,
  command,
  args = [],
  input,
  env = {},
  shell = false,
  timeoutMs,
  stdoutStream,
  stderrStream
}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      env: { ...process.env, ...env },
      detached: Boolean(timeoutMs) && process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    let sequence = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer;

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
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr, timedOut });
    });
    if (timeoutMs) {
      killTimer = setTimeout(() => {
        timedOut = true;
        void append(stderrStream, `\nBenchmark timed out after ${Math.ceil(timeoutMs / 1000)} seconds.\n`);
        terminateProcessTree(child);
      }, timeoutMs);
    }
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 5000).unref();
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

async function storeDiagramArtifacts({ client, session, experiment, runId, workspacePath, changedFiles }) {
  const sources = changedFiles.filter((file) => isTikzSource(workspacePath, file));
  if (sources.length === 0) {
    if (requiresDiagramUpdate(session, experiment)) {
      throw new Error(
        "architecture_change experiments must create or update an editable TikZ .tex diagram source; add figures/**/*.tex to editablePaths if this session does not expose a diagram source path"
      );
    }
    return [];
  }

  const artifactIds = [];
  for (const sourcePath of sources) {
    const artifact = compileTikzArtifact(workspacePath, sourcePath);
    const artifactId = await client.mutation(api.orchestration.recordResearchArtifact, {
      runId,
      kind: "model_architecture_png",
      sourcePath,
      path: artifact.path,
      mimeType: "image/png",
      byteLength: artifact.bytes.byteLength,
      bytes: bufferToArrayBuffer(artifact.bytes),
      contentHash: artifact.contentHash
    });
    artifactIds.push(artifactId);
  }
  return artifactIds;
}

function requiresDiagramUpdate(session, experiment) {
  return isArchitectureChange(experiment);
}

function isArchitectureChange(experiment) {
  return String(experiment.changeKind ?? "") === "architecture_change";
}

function isTikzSource(workspacePath, file) {
  const normalized = normalizeRelativePath(file);
  if (!normalized.toLowerCase().endsWith(".tex")) {
    return false;
  }
  const absolutePath = safeResolveWorkspacePath(workspacePath, normalized);
  if (!fs.existsSync(absolutePath)) {
    return false;
  }
  const content = safeReadText(absolutePath);
  return content.includes("\\begin{tikzpicture}") ||
    content.includes("\\usetikzlibrary") ||
    /\\documentclass(?:\[[^\]]*\])?\{standalone\}/u.test(content);
}

function compileTikzArtifact(workspacePath, sourcePath) {
  const sourceAbsolutePath = safeResolveWorkspacePath(workspacePath, sourcePath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-tikz-"));
  try {
    const pdfPath = compileTikzPdf(sourceAbsolutePath, tempDir);
    const png = convertPdfToSizedPng(pdfPath, tempDir);
    const contentHash = crypto.createHash("sha256").update(png).digest("hex");
    return {
      path: artifactPngPath(sourcePath),
      bytes: png,
      contentHash
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function compileTikzPdf(sourceAbsolutePath, outputDir) {
  const latexmk = findExecutable("latexmk", [TEX_BIN_DIR]);
  const pdflatex = findExecutable("pdflatex", [TEX_BIN_DIR]);
  const cwd = path.dirname(sourceAbsolutePath);
  const compileSourcePath = prepareTikzSourceForCompilation(sourceAbsolutePath, outputDir);
  if (latexmk) {
    runCommandOrThrow(latexmk, [
      "-pdf",
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-outdir=${outputDir}`,
      compileSourcePath
    ], cwd);
  } else if (pdflatex) {
    runCommandOrThrow(pdflatex, [
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-output-directory=${outputDir}`,
      compileSourcePath
    ], cwd);
  } else {
    throw new Error("TikZ artifact rendering requires latexmk or pdflatex. Run `autoresearch doctor`.");
  }

  const pdfPath = path.join(outputDir, `${path.basename(sourceAbsolutePath, ".tex")}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`TikZ artifact rendering did not produce ${pdfPath}`);
  }
  return pdfPath;
}

export function prepareTikzSourceForCompilation(sourceAbsolutePath, outputDir) {
  const content = fs.readFileSync(sourceAbsolutePath, "utf8");
  const requiredPackages = [];
  if (/\\mathbb\b/u.test(content) && !hasLatexPackage(content, ["amsfonts", "amssymb"])) {
    requiredPackages.push("amsfonts");
  }
  if (requiredPackages.length === 0) {
    return sourceAbsolutePath;
  }

  const patched = insertLatexPackages(content, requiredPackages);
  const patchedPath = path.join(outputDir, path.basename(sourceAbsolutePath));
  fs.writeFileSync(patchedPath, patched, "utf8");
  return patchedPath;
}

function hasLatexPackage(content, packageNames) {
  const wanted = new Set(packageNames);
  for (const match of content.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/gu)) {
    for (const packageName of match[1].split(",").map((item) => item.trim())) {
      if (wanted.has(packageName)) return true;
    }
  }
  return false;
}

function insertLatexPackages(content, packageNames) {
  const packageLines = packageNames.map((packageName) => `\\usepackage{${packageName}}`).join("\n");
  const usePackageMatches = [...content.matchAll(/^\\usepackage(?:\[[^\]]*\])?\{[^}]+\}\s*$/gmu)];
  if (usePackageMatches.length > 0) {
    const last = usePackageMatches.at(-1);
    const insertAt = last.index + last[0].length;
    return `${content.slice(0, insertAt)}\n${packageLines}${content.slice(insertAt)}`;
  }

  const documentClassMatch = content.match(/^\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*$/mu);
  if (!documentClassMatch) {
    return `${packageLines}\n${content}`;
  }
  const insertAt = documentClassMatch.index + documentClassMatch[0].length;
  return `${content.slice(0, insertAt)}\n${packageLines}${content.slice(insertAt)}`;
}

function convertPdfToSizedPng(pdfPath, tempDir) {
  const pdftoppm = findExecutable("pdftoppm");
  const qlmanage = findExecutable("qlmanage");
  const attempts = pdftoppm
    ? PDFTOPPM_RESOLUTIONS.map((resolution) => ({ tool: "pdftoppm", value: resolution }))
    : QUICKLOOK_SIZES.map((size) => ({ tool: "qlmanage", value: size }));

  if (attempts.length === 0 || (!pdftoppm && !qlmanage)) {
    throw new Error("TikZ artifact rendering requires pdftoppm or qlmanage for PNG export.");
  }

  let largestBytes = 0;
  for (const attempt of attempts) {
    const renderDir = fs.mkdtempSync(path.join(tempDir, "render-"));
    const pngPath = attempt.tool === "pdftoppm"
      ? renderWithPdftoppm(pdftoppm, pdfPath, renderDir, attempt.value)
      : renderWithQuickLook(qlmanage, pdfPath, renderDir, attempt.value);
    const png = fs.readFileSync(pngPath);
    largestBytes = Math.max(largestBytes, png.byteLength);
    if (png.byteLength <= MAX_ARTIFACT_BYTES) {
      return png;
    }
  }

  throw new Error(
    `TikZ PNG artifact is too large for Convex storage (${largestBytes} bytes; max ${MAX_ARTIFACT_BYTES})`
  );
}

function renderWithPdftoppm(pdftoppm, pdfPath, renderDir, resolution) {
  const prefix = path.join(renderDir, "artifact");
  runCommandOrThrow(pdftoppm, [
    "-png",
    "-singlefile",
    "-r",
    String(resolution),
    pdfPath,
    prefix
  ], renderDir);
  const pngPath = `${prefix}.png`;
  if (!fs.existsSync(pngPath)) {
    throw new Error(`pdftoppm did not produce ${pngPath}`);
  }
  return pngPath;
}

function renderWithQuickLook(qlmanage, pdfPath, renderDir, size) {
  runCommandOrThrow(qlmanage, ["-t", "-s", String(size), "-o", renderDir, pdfPath], renderDir);
  const pngs = fs.readdirSync(renderDir)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .map((file) => path.join(renderDir, file));
  if (pngs.length === 0) {
    throw new Error("qlmanage did not produce a PNG preview");
  }
  return pngs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function artifactPngPath(sourcePath) {
  return normalizeRelativePath(sourcePath).replace(/\.tex$/iu, ".png");
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function collectPatch(workspacePath, session, baseRef = "HEAD") {
  const entries = changedEntriesFromGit(workspacePath, baseRef).filter((entry) => shouldIncludePatchFile(workspacePath, entry.file, session));
  const changedFiles = entries.map((entry) => entry.file);
  const rejectedFiles = changedFiles.filter((file) => !isEditable(file, session.editablePaths));
  const fullDiff = buildDiff(workspacePath, entries, baseRef);
  const diffStat = buildDiffStat(workspacePath, entries, baseRef);
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

function shouldIncludePatchFile(workspacePath, file, session) {
  if (RUNNER_METADATA_FILES.has(file)) return false;
  if (isWorkspaceLink(file, session?.workspaceLinks)) return false;
  if (isPatchOutputArtifact(file)) return false;
  if (isRenderedTexArtifact(workspacePath, file)) return false;
  return !isGeneratedArtifact(file);
}

function isWorkspaceLink(file, links) {
  const normalized = normalizeRelativePath(file);
  return normalizeWorkspaceLinks(links).some((link) => link.workspacePath === normalized);
}

function isPatchOutputArtifact(file) {
  const normalized = normalizeRelativePath(file);
  const isNestedSessionArtifact =
    normalized.startsWith(".autoresearch/sessions/") && normalized.includes("/artifacts/");
  return (
    normalized === "artifacts" ||
    normalized.startsWith("artifacts/") ||
    isNestedSessionArtifact
  );
}

function isRenderedTexArtifact(workspacePath, file) {
  const normalized = normalizeRelativePath(file);
  const lower = normalized.toLowerCase();
  if (!lower.endsWith(".pdf") && !lower.endsWith(".png")) {
    return false;
  }
  const texPath = normalized.replace(/\.(pdf|png)$/iu, ".tex");
  return fs.existsSync(path.join(workspacePath, texPath));
}

function changedEntriesFromGit(workspacePath, baseRef) {
  const status = gitOutput(["status", "--porcelain=v1", "-uall"], workspacePath);
  const diffStatus = gitOutput(["diff", "--name-status", baseRef, "--"], workspacePath);
  const entries = [];
  for (const line of diffStatus.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(/\t+/);
    const statusCode = parts[0] || "M";
    const file = parts.at(-1);
    if (file) entries.push({ file: normalizeRelativePath(file), status: statusCode });
  }
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

function buildDiff(workspacePath, entries, baseRef) {
  if (entries.length === 0) return "";
  const tracked = entries.filter((entry) => entry.status !== "??").map((entry) => entry.file);
  const parts = [];
  if (tracked.length > 0) {
    parts.push(gitOutput(["diff", baseRef, "--", ...tracked], workspacePath));
  }
  for (const entry of entries.filter((item) => item.status === "??")) {
    parts.push(untrackedFileDiff(workspacePath, entry.file));
  }
  return parts.filter(Boolean).join("\n");
}

function buildDiffStat(workspacePath, entries, baseRef) {
  if (entries.length === 0) return "";
  const tracked = entries.filter((entry) => entry.status !== "??").map((entry) => entry.file);
  const parts = [];
  if (tracked.length > 0) {
    parts.push(gitOutput(["diff", "--stat", baseRef, "--", ...tracked], workspacePath));
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

function safeResolveWorkspacePath(workspacePath, relativePath) {
  const workspaceRoot = path.resolve(workspacePath);
  const absolutePath = path.resolve(workspaceRoot, normalizeRelativePath(relativePath));
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return absolutePath;
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

function runCommandOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: texProcessEnv(),
    encoding: "utf8",
    maxBuffer: 2_000_000
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`${path.basename(command)} failed: ${output.slice(-3000)}`);
  }
  return result;
}

function texProcessEnv() {
  return {
    ...process.env,
    PATH: [TEX_BIN_DIR, process.env.PATH].filter(Boolean).join(path.delimiter)
  };
}

function isEditable(file, editablePatterns) {
  const normalized = normalizeRelativePath(file);
  return (editablePatterns ?? []).some((pattern) => globMatch(normalized, normalizeRelativePath(pattern)));
}

function globMatch(file, pattern) {
  const regex = new RegExp(`^${globToRegexSource(pattern)}$`);
  return regex.test(file);
}

function globToRegexSource(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return source;
}

function normalizeRelativePath(value) {
  return String(value).replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeMemoryConfig(value) {
  if (value === undefined || value === null) {
    value = {};
  }
  if (!isPlainObject(value) || value.enabled === false) {
    return null;
  }
  const rootPath = normalizeRelativePath(value.rootPath || "research").replace(/\/+$/g, "");
  const memory = {
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
  return memory;
}

function normalizeMemoryRoleConfig(value, defaultEnabled) {
  if (typeof value === "boolean") return { enabled: value };
  if (isPlainObject(value)) {
    return { ...value, enabled: value.enabled !== false };
  }
  return { enabled: defaultEnabled };
}

function safeResolveRepoPath(repoPath, relativePath) {
  const repoRoot = path.resolve(repoPath);
  const absolutePath = path.resolve(repoRoot, normalizeRelativePath(relativePath));
  if (absolutePath !== repoRoot && !absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Path escapes repoPath: ${relativePath}`);
  }
  return absolutePath;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
