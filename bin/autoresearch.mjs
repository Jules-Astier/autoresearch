#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "dev" || command === "start") {
    await runScript("dev-stack.mjs", argv);
    return;
  }
  if (command === "register") {
    await registerSession(argv);
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

async function registerSession(argv) {
  const args = parseArgs(argv);
  const sessionDirArg = args._[0];
  if (!sessionDirArg) {
    throw new Error("Usage: autoresearch register <session-dir> [--convex-url URL]");
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
    targetExperimentCount: requiredPositiveInteger(contract.targetExperimentCount, "targetExperimentCount"),
    maxConcurrentRuns: requiredNonNegativeInteger(contract.maxConcurrentRuns, "maxConcurrentRuns"),
    editablePaths: requiredStringArray(contract.editablePaths, "editablePaths"),
    immutablePaths: stringArray(contract.immutablePaths, "immutablePaths"),
    runtimeConfigPaths: stringArray(contract.runtimeConfigPaths, "runtimeConfigPaths"),
    modelIoContract: optionalString(contract.modelIoContract),
    metricContract,
    earlyStopping: contract.earlyStopping
  };
}

function normalizeMetricContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("metricContract must be an object");
  }
  const primaryMetric = requiredString(contract.primaryMetric, "metricContract.primaryMetric");
  const direction = String(contract.direction ?? "").trim().toLowerCase();
  if (direction !== "minimize" && direction !== "maximize") {
    throw new Error("metricContract.direction must be minimize or maximize");
  }
  return {
    ...contract,
    primaryMetric,
    direction,
    metrics: Array.isArray(contract.metrics) && contract.metrics.length > 0
      ? contract.metrics
      : [{ name: primaryMetric, direction }]
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

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
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
  autoresearch dev
  autoresearch register <session-dir> [--convex-url URL] [--dry-run]
  autoresearch runner [runner options]
  autoresearch orchestrator [orchestrator options]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
