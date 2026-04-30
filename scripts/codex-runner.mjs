#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCode, codex as sandcastleCodex, opencode, pi, run as runSandcastle } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_WORKSPACE_ROOT = path.resolve(ROOT, "..", ".runtime", "codex-runner");
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
      const provider = createAgentProvider(config);
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendMemoryKeeperLog(client, runId, `memory keeper failed: ${message}\n`);
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

function buildAgentPrompt({ session, basePatch, experiment, priorExperiments, workspacePath }) {
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

Rules:
- Make exactly one coherent research change.
- You may make PyTorch architecture changes if model inputs and outputs stay compatible.
- You may make runtime config or hyperparameter changes in declared config files.
- For architecture_change work, update the repo's TikZ model diagram source when a diagram .tex path is editable. Use .agents/skills/model-diagram-tikz/SKILL.md if present.
- Do not commit rendered diagram PDFs or PNGs. The runner compiles changed TikZ .tex sources and stores only the PNG artifact.
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
    stderr: result.stderr
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
      branchStrategy: { type: "head" },
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
    logFilePath: result.logFilePath
  };
}

async function runBenchmarkInSandcastle({ client, session, experiment, runId, workspacePath, config }) {
  const pendingLogs = [];
  let result;
  try {
    result = await runSandcastle({
      cwd: workspacePath,
      branchStrategy: { type: "head" },
      sandbox: createSandcastleSandboxProvider(config),
      agent: createBenchmarkAgent(session.benchmarkCommand, config),
      prompt: `Run the benchmark command for Autoresearch experiment #${experiment.ordinal}.`,
      maxIterations: 1,
      completionSignal: "__AUTORESEARCH_EXIT_CODE__:",
      idleTimeoutSeconds: config.benchmarkIdleTimeoutSeconds ?? config.idleTimeoutSeconds,
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
  const configured =
    args.runnerBackend ??
    args.backend ??
    process.env.AUTORESEARCH_RUNNER_BACKEND ??
    sandboxConfig.backend;
  if (configured) {
    return String(configured).trim().toLowerCase();
  }
  return sandboxConfig.enabled === true ? "sandcastle" : "direct";
}

function resolveRunnerConfig(session, args) {
  const raw = isPlainObject(session.sandbox) ? session.sandbox : {};
  const sessionAgentRaw = isPlainObject(session.agent) ? session.agent : {};
  const sandboxAgentRaw = isPlainObject(raw.agent) ? raw.agent : {};
  const agentRaw = { ...sessionAgentRaw, ...sandboxAgentRaw };
  const repoName = path.basename(path.resolve(session.repoPath));
  return {
    backend: resolveRunnerBackend(session, args),
    provider: stringOption(
      args.sandcastleProvider,
      process.env.AUTORESEARCH_SANDCASTLE_PROVIDER,
      raw.provider,
      "docker"
    ),
    imageName: stringOption(
      args.sandcastleImage,
      process.env.AUTORESEARCH_SANDCASTLE_IMAGE,
      raw.imageName,
      defaultSandcastleImageName(repoName)
    ),
    network: stringOrStringArray(raw.network),
    mounts: normalizeSandcastleMounts(raw.mounts),
    env: resolveSandcastleEnv(raw, agentRaw),
    setupCommands: normalizeCommandList(raw.setupCommands, raw.setupCommand),
    setupTimeoutMs: positiveNumber(raw.setupTimeoutMs),
    agentProvider: stringOption(
      args.agentProvider,
      args.agent,
      process.env.AUTORESEARCH_AGENT_PROVIDER,
      agentRaw.provider,
      raw.agentProvider,
      "codex"
    ),
    model: stringOption(
      args.agentModel,
      args.model,
      process.env.AUTORESEARCH_AGENT_MODEL,
      args.sandcastleModel,
      process.env.AUTORESEARCH_SANDCASTLE_MODEL,
      agentRaw.model,
      process.env.AUTORESEARCH_CODEX_MODEL,
      "gpt-5.4"
    ),
    effort: optionalStringValue(
      args.agentEffort,
      args.effort,
      process.env.AUTORESEARCH_AGENT_EFFORT,
      args.sandcastleEffort,
      process.env.AUTORESEARCH_SANDCASTLE_EFFORT,
      agentRaw.effort
    ),
    maxIterations: positiveInteger(raw.maxIterations, 1),
    completionSignal: optionalStringValue(raw.completionSignal),
    idleTimeoutSeconds: positiveInteger(raw.idleTimeoutSeconds, 600),
    benchmarkIdleTimeoutSeconds: positiveInteger(raw.benchmarkIdleTimeoutSeconds)
  };
}

function createSandcastleSandboxProvider(config) {
  const options = {
    imageName: config.imageName,
    mounts: config.mounts,
    env: config.env,
    network: config.network
  };
  if (config.provider === "docker") {
    return docker(options);
  }
  if (config.provider === "podman") {
    return podman(options);
  }
  throw new Error(`Unsupported Sandcastle provider: ${config.provider}`);
}

function createAgentProvider(config) {
  const provider = config.agentProvider.toLowerCase();
  if (provider === "codex") {
    return sandcastleCodex(config.model, { effort: config.effort, env: config.env });
  }
  if (provider === "claude-code" || provider === "claude") {
    return claudeCode(config.model, { effort: config.effort, env: config.env });
  }
  if (provider === "opencode") {
    return opencode(config.model, { env: config.env });
  }
  if (provider === "pi") {
    return pi(config.model, { env: config.env });
  }
  throw new Error(`Unsupported agent provider: ${config.agentProvider}`);
}

function createBenchmarkAgent(command, config) {
  const script = `(
${command}
) 2>&1
code=$?
printf '\\n__AUTORESEARCH_EXIT_CODE__:%s\\n' "$code"
exit 0`;
  return {
    name: "benchmark",
    env: config.env,
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

function resolveSandcastleEnv(raw, agentRaw) {
  return {
    ...envRecord(raw.env),
    ...envRecord(agentRaw.env),
    ...envVars(raw.envVars),
    ...envVars(agentRaw.envVars)
  };
}

function envVars(value) {
  if (!Array.isArray(value)) return {};
  const env = {};
  for (const name of value) {
    const key = String(name || "").trim();
    if (!key) continue;
    const envValue = process.env[key];
    if (envValue === undefined) {
      throw new Error(`Missing environment variable requested by Sandcastle config: ${key}`);
    }
    env[key] = envValue;
  }
  return env;
}

function envRecord(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key && item !== undefined && item !== null)
      .map(([key, item]) => [key, String(item)])
  );
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
    let stdoutLineBuffer = "";
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
      resolve({ code: code ?? 1, stdout, stderr, result });
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
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

async function storeDiagramArtifacts({ client, session, experiment, runId, workspacePath, changedFiles }) {
  const sources = changedFiles.filter((file) => isTikzSource(workspacePath, file));
  if (sources.length === 0) {
    if (requiresDiagramUpdate(session, experiment)) {
      throw new Error(
        "architecture_change experiments must update an editable TikZ .tex diagram source"
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
  if (String(experiment.changeKind ?? "") !== "architecture_change") {
    return false;
  }
  return (session.editablePaths ?? []).some((pattern) => {
    const normalized = normalizeRelativePath(pattern).toLowerCase();
    return normalized.endsWith(".tex") ||
      normalized.includes("*.tex") ||
      normalized.includes(".tikz") ||
      normalized.startsWith("figures/");
  });
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
  if (latexmk) {
    runCommandOrThrow(latexmk, [
      "-pdf",
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-outdir=${outputDir}`,
      sourceAbsolutePath
    ], cwd);
  } else if (pdflatex) {
    runCommandOrThrow(pdflatex, [
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-output-directory=${outputDir}`,
      sourceAbsolutePath
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

function collectPatch(workspacePath, session, baseRef = "HEAD") {
  const entries = changedEntriesFromGit(workspacePath, baseRef).filter((entry) => shouldIncludePatchFile(workspacePath, entry.file));
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

function shouldIncludePatchFile(workspacePath, file) {
  if (RUNNER_METADATA_FILES.has(file)) return false;
  if (isRenderedTexArtifact(workspacePath, file)) return false;
  return !isGeneratedArtifact(file);
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

function normalizeMemoryConfig(value) {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
