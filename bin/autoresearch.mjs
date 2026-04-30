#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
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
    agent: normalizeAgentConfig(contract.agent),
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
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new Error("sandbox must be an object when provided");
  }
  const backend = optionalString(value.backend)?.toLowerCase();
  if (backend !== undefined && backend !== "sandcastle" && backend !== "direct") {
    throw new Error("sandbox.backend must be sandcastle or direct");
  }
  const provider = optionalString(value.provider)?.toLowerCase();
  if (provider !== undefined && provider !== "docker" && provider !== "podman") {
    throw new Error("sandbox.provider must be docker or podman");
  }
  const normalized = { ...value };
  if (backend === undefined) delete normalized.backend;
  else normalized.backend = backend;
  if (provider === undefined) delete normalized.provider;
  else normalized.provider = provider;
  return normalized;
}

function normalizeAgentConfig(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new Error("agent must be an object when provided");
  }
  const provider = optionalString(value.provider)?.toLowerCase();
  if (
    provider !== undefined &&
    provider !== "codex" &&
    provider !== "claude-code" &&
    provider !== "claude" &&
    provider !== "opencode" &&
    provider !== "pi"
  ) {
    throw new Error("agent.provider must be codex, claude-code, opencode, or pi");
  }
  const normalized = { ...value };
  if (provider === undefined) delete normalized.provider;
  else normalized.provider = provider;
  return normalized;
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  autoresearch doctor
  autoresearch install-tex --macos
  autoresearch runner [runner options]
  autoresearch orchestrator [orchestrator options]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
