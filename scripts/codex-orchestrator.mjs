#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_WORKSPACE_ROOT = path.resolve(ROOT, "..", ".runtime", "codex-orchestrator");

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
  console.log(`Codex orchestrator ${workerId} connected to ${convexUrl}`);

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

  const plannerPrompt = buildPlannerPrompt({ session, experiments, patches, requestedCount });
  const plannerOutput = await runCodex({
    cwd: fs.existsSync(repoPath) ? repoPath : ROOT,
    outputPath: path.join(cycleDir, "planner-final.md"),
    prompt: plannerPrompt,
    args
  });
  const plan = parseJsonObject(plannerOutput, "planner");

  const reviewerPrompt = buildReviewerPrompt({ session, experiments, plan, requestedCount });
  const reviewerOutput = await runCodex({
    cwd: fs.existsSync(repoPath) ? repoPath : ROOT,
    outputPath: path.join(cycleDir, "reviewer-final.md"),
    prompt: reviewerPrompt,
    args
  });
  const review = parseJsonObject(reviewerOutput, "reviewer");
  const approved = normalizeApprovedExperiments(review, plan, requestedCount);

  if (approved.length === 0) {
    throw new Error("reviewer approved no experiments");
  }

  await client.mutation(api.orchestration.finishPlanningCycle, {
    planningCycleId,
    plannerOutput,
    reviewerOutput,
    approvedExperiments: approved
  });
  console.log(`Queued ${approved.length} approved experiments for ${session.slug}`);
}

function buildPlannerPrompt({ session, experiments, patches, requestedCount }) {
  const recent = experiments
    .slice(-20)
    .map((experiment) => {
      const metrics = experiment.metrics ? JSON.stringify(experiment.metrics) : "{}";
      return `- #${experiment.ordinal} ${experiment.status}: ${experiment.hypothesis} metrics=${metrics}`;
    })
    .join("\n");
  const recentPatches = patches
    .slice(0, 8)
    .map((patch) => `- ${patch.status} ${patch.contentHash.slice(0, 12)} files=${patch.changedFiles.join(", ")}`)
    .join("\n");

  return `You are the planner for a Convex-backed ML autoresearch system.

Plan ${requestedCount} independent, non-duplicate experiments that can run in parallel.

Session:
${JSON.stringify({
  title: session.title,
  slug: session.slug,
  benchmarkCommand: session.benchmarkCommand,
  targetExperimentCount: session.targetExperimentCount,
  completedExperimentCount: session.completedExperimentCount,
  maxConcurrentRuns: session.maxConcurrentRuns,
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

Rules:
- Propose only changes that fit editable paths.
- Prefer independent changes that can run in parallel without depending on each other.
- Avoid duplicate or stale hypotheses.
- Each experiment must be one coherent change.
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

function buildReviewerPrompt({ session, experiments, plan, requestedCount }) {
  return `You are the reviewer for an ML autoresearch batch.

Review the proposed experiments for hard-rule violations, duplicates, stale ideas, multi-change scope, and dependency between experiments.
Approve at most ${requestedCount} experiments that are safe to run in parallel.

Session editable paths:
${session.editablePaths.map((item) => `- ${item}`).join("\n")}

Immutable paths:
${session.immutablePaths.map((item) => `- ${item}`).join("\n")}

Prior experiments:
${experiments.slice(-20).map((item) => `- #${item.ordinal} ${item.status}: ${item.hypothesis}`).join("\n") || "- none"}

Planner proposal:
${JSON.stringify(plan, null, 2)}

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

async function runCodex({ cwd, outputPath, prompt, args }) {
  if (args.dryRun) {
    return JSON.stringify({
      experiments: [
        {
          hypothesis: "Dry-run config change placeholder.",
          changeKind: "config_change",
          prompt: "Dry-run only; do not execute.",
          expectedImpact: "none",
          independenceReason: "dry-run"
        }
      ],
      approvedExperiments: [
        {
          hypothesis: "Dry-run config change placeholder.",
          changeKind: "config_change",
          prompt: "Dry-run only; do not execute."
        }
      ]
    });
  }

  const codexBin = args.codexBin ?? process.env.AUTORESEARCH_CODEX_BIN ?? "codex";
  const codexArgs = [
    "exec",
    "--cd",
    cwd,
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
    "--sandbox",
    "read-only",
    "-"
  ];
  await runProcess(codexBin, codexArgs, prompt, cwd);
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Codex did not write output: ${outputPath}`);
  }
  return fs.readFileSync(outputPath, "utf8");
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

function runProcess(command, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "inherit", "inherit"]
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
    child.stdin.write(input);
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
