#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STACK_STATE_PATH = path.join(ROOT, ".autoresearch", "runtime", "stack.json");
const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";
const DEFAULT_DEV_FRONTEND_PORT = 5173;
const DEFAULT_PREVIEW_FRONTEND_PORT = 4173;

let stopping = false;
const processGroups = new Set();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  writeStackState(args);
  process.once("exit", clearStackState);
  const envPath = path.join(ROOT, ".env.local");
  const envFile = loadEnvFile(envPath);
  let convexUrl =
    args.convexUrl ??
    process.env.CONVEX_URL ??
    process.env.VITE_CONVEX_URL ??
    envFile.VITE_CONVEX_URL ??
    DEFAULT_CONVEX_URL;

  const canReuseConvex = args.reuse !== false && (await canConnectUrl(convexUrl));
  if (canReuseConvex) {
    console.log(`[convex] reusing local backend at ${convexUrl}`);
  } else {
    const convex = spawnManaged("convex", localBin("convex"), ["dev", "--local"], {
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" }
    });
    prefixOutput(convex.child, "convex");
    convexUrl = await waitForConvexReady(envPath, convexUrl, convex.child);
  }

  const frontendMode = args.frontendMode ?? "dev";
  if (frontendMode === "preview") {
    await runBuild(convexUrl);
  }
  const frontendPort =
    args.frontendPort ??
    (frontendMode === "preview" ? DEFAULT_PREVIEW_FRONTEND_PORT : DEFAULT_DEV_FRONTEND_PORT);
  const frontendArgs =
    frontendMode === "preview"
      ? ["preview", "--host", "127.0.0.1", "--port", String(frontendPort)]
      : ["--host", "127.0.0.1", "--port", String(frontendPort)];
  const frontend = spawnManaged("frontend", localBin("vite"), frontendArgs, {
    env: {
      ...process.env,
      CONVEX_URL: convexUrl,
      VITE_CONVEX_URL: convexUrl
    }
  });
  const frontendUrl = await waitForFrontendUrl(frontend.child);

  printStackUrls({ convexUrl, frontendUrl });
  const supervisor = args.workers === false ? null : startWorkerSupervisor({ convexUrl, args });

  process.on("SIGINT", () => void shutdown(supervisor, 0));
  process.on("SIGTERM", () => void shutdown(supervisor, 0));
}

function startWorkerSupervisor({ convexUrl, args }) {
  const client = new ConvexHttpClient(convexUrl);
  const pollMs = Number(args.workerPollMs ?? 3000);
  const orchestrators = new Map();
  const runners = new Map();
  let lastDesired = "";

  async function tick() {
    if (stopping) {
      return;
    }
    try {
      const [control, sessions] = await Promise.all([
        client.query(api.orchestration.getWorkerControl, {}),
        client.query(api.orchestration.listResearchSessions, {})
      ]);
      const desiredRunnerCount = Number(control?.desiredRunnerCount ?? 0);
      const runningSessions = sessions.filter((session) => session.status === "running");
      const desiredKey = `${desiredRunnerCount}:${runningSessions.map((session) => session._id).join(",")}`;
      if (desiredKey !== lastDesired) {
        console.log(`[workers] desired runners=${desiredRunnerCount} active sessions=${runningSessions.length}`);
        lastDesired = desiredKey;
      }
      reconcileSessionOrchestrators({ sessions: runningSessions, workers: orchestrators, convexUrl });
      reconcileWorkers({
        kind: "runner",
        desired: desiredRunnerCount,
        workers: runners,
        command: process.execPath,
        args: [
          path.join(ROOT, "scripts", "codex-runner.mjs"),
          "--worker-id",
          "",
          "--poll-ms",
          "2000"
        ],
        convexUrl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[workers] ${message}`);
    }
  }

  const timer = setInterval(() => void tick(), pollMs);
  void tick();

  return {
    stop() {
      clearInterval(timer);
      for (const worker of [...orchestrators.values(), ...runners.values()]) {
        stopChild(worker.child);
      }
    }
  };
}

function reconcileSessionOrchestrators({ sessions, workers, convexUrl }) {
  const desiredIds = new Set(sessions.map((session) => session._id));
  for (const [sessionId, worker] of [...workers.entries()]) {
    if (!desiredIds.has(sessionId)) {
      console.log(`[workers] stopping orchestrator ${worker.workerId}`);
      workers.delete(sessionId);
      stopChild(worker.child);
    }
  }

  for (const session of sessions) {
    if (workers.has(session._id)) {
      continue;
    }
    const suffix = slug(session.slug || session._id).slice(0, 36);
    const workerId = `ui-orchestrator-${suffix}`;
    const child = spawnManaged(`orchestrator-${suffix}`, process.execPath, [
      path.join(ROOT, "scripts", "codex-orchestrator.mjs"),
      "--session-id",
      session._id,
      "--worker-id",
      workerId,
      "--poll-ms",
      "3000"
    ], {
      env: {
        ...process.env,
        CONVEX_URL: convexUrl,
        VITE_CONVEX_URL: convexUrl
      }
    }).child;
    workers.set(session._id, { child, workerId });
    prefixOutput(child, `orchestrator:${suffix}`);
    child.once("exit", () => {
      workers.delete(session._id);
    });
    console.log(`[workers] started ${workerId}`);
  }
}

function reconcileWorkers({ kind, desired, workers, command, args, convexUrl }) {
  const desiredCount = clampInteger(desired, 0, 64);
  while (workers.size < desiredCount) {
    const index = nextWorkerIndex(workers);
    const workerId = `ui-${kind}-${index}`;
    const workerArgs = args.map((item) => (item === "" ? workerId : item));
    const child = spawnManaged(`${kind}-${index}`, command, workerArgs, {
      env: {
        ...process.env,
        CONVEX_URL: convexUrl,
        VITE_CONVEX_URL: convexUrl
      }
    }).child;
    workers.set(index, { child });
    prefixOutput(child, `${kind}-${index}`);
    child.once("exit", () => {
      workers.delete(index);
    });
    console.log(`[workers] started ${workerId}`);
  }

  while (workers.size > desiredCount) {
    const index = Math.max(...workers.keys());
    const worker = workers.get(index);
    workers.delete(index);
    if (worker) {
      console.log(`[workers] stopping ui-${kind}-${index}`);
      stopChild(worker.child);
    }
  }
}

function nextWorkerIndex(workers) {
  let index = 1;
  while (workers.has(index)) {
    index += 1;
  }
  return index;
}

async function waitForConvexReady(envPath, fallbackUrl, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    if (child.exitCode !== null) {
      throw new Error(`convex dev exited with ${child.exitCode}`);
    }
    const envFile = loadEnvFile(envPath);
    const candidate = envFile.VITE_CONVEX_URL ?? fallbackUrl ?? DEFAULT_CONVEX_URL;
    if (await canConnectUrl(candidate)) {
      console.log(`[convex] backend ready at ${candidate}`);
      return candidate;
    }
    await sleep(500);
  }
  throw new Error("timed out waiting for local Convex backend");
}

function waitForFrontendUrl(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("timed out waiting for Vite frontend URL"));
      }
    }, 120000);

    prefixOutput(child, "frontend", (line) => {
      if (settled) {
        return;
      }
      const url = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?/u)?.[0];
      if (url) {
        settled = true;
        clearTimeout(timeout);
        resolve(url);
      }
    });

    child.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`frontend exited with ${code}`));
      }
    });
  });
}

function spawnManaged(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const group = { name, child };
  processGroups.add(group);
  child.once("exit", (code, signal) => {
    processGroups.delete(group);
    if (!stopping && name === "frontend") {
      console.error(`[${name}] exited with code=${code} signal=${signal}`);
    }
  });
  child.once("error", (error) => {
    console.error(`[${name}] ${error.message}`);
  });
  return group;
}

function prefixOutput(child, prefix, onLine) {
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length > 0) {
          console.log(`[${prefix}] ${line}`);
          onLine?.(line);
        }
      }
    });
  }
}

function printStackUrls({ convexUrl, frontendUrl }) {
  console.log("");
  console.log("Local autoresearch stack");
  console.log(`  Convex backend: ${convexUrl}`);
  console.log(`  React frontend: ${frontendUrl}`);
  console.log("  Worker control: use Runners in the frontend");
  console.log("");
}

function writeStackState(args) {
  fs.mkdirSync(path.dirname(STACK_STATE_PATH), { recursive: true });
  const frontendMode = args.frontendMode ?? "dev";
  fs.writeFileSync(
    STACK_STATE_PATH,
    `${JSON.stringify({
      pid: process.pid,
      root: ROOT,
      frontendMode,
      argv: process.argv.slice(2),
      startedAtUtc: new Date().toISOString()
    }, null, 2)}\n`
  );
}

function clearStackState() {
  try {
    const state = JSON.parse(fs.readFileSync(STACK_STATE_PATH, "utf8"));
    if (state?.pid === process.pid) {
      fs.rmSync(STACK_STATE_PATH, { force: true });
    }
  } catch {
    // A newer stack may already have replaced the state file.
  }
}

async function shutdown(supervisor, code) {
  if (stopping) {
    return;
  }
  stopping = true;
  supervisor?.stop();
  for (const group of [...processGroups]) {
    stopChild(group.child);
  }
  setTimeout(() => process.exit(code), 500);
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGINT");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }, 2000);
}

function localBin(name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const candidate = path.join(ROOT, "node_modules", ".bin", `${name}${suffix}`);
  return fs.existsSync(candidate) ? candidate : name;
}

async function runBuild(convexUrl) {
  console.log("[frontend] building production frontend");
  await runCommand(localBin("tsc"), ["-b"], { convexUrl });
  await runCommand(localBin("vite"), ["build"], { convexUrl });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        CONVEX_URL: options.convexUrl ?? process.env.CONVEX_URL,
        VITE_CONVEX_URL: options.convexUrl ?? process.env.VITE_CONVEX_URL
      },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function canConnectUrl(urlString) {
  try {
    const url = new URL(urlString);
    return canConnect(url.hostname, Number(url.port));
  } catch {
    return false;
  }
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 600 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) {
      values[match[1]] = match[2].replace(/^"|"$/gu, "");
    }
  }
  return values;
}

function parseArgs(argv) {
  const parsed = { reuse: true, workers: true };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      parsed.help = true;
      continue;
    }
    if (item === "--no-reuse") {
      parsed.reuse = false;
      continue;
    }
    if (item === "--no-workers") {
      parsed.workers = false;
      continue;
    }
    if (item === "--convex-url") {
      parsed.convexUrl = argv[++index];
      continue;
    }
    if (item === "--frontend-port" || item === "--port") {
      parsed.frontendPort = Number(argv[++index]);
      continue;
    }
    if (item === "--frontend-mode") {
      parsed.frontendMode = parseFrontendMode(argv[++index]);
      continue;
    }
    if (item === "--worker-poll-ms") {
      parsed.workerPollMs = Number(argv[++index]);
      continue;
    }
    throw new Error(`Unknown stack option: ${item}`);
  }
  return parsed;
}

function parseFrontendMode(value) {
  if (value === "dev" || value === "preview") {
    return value;
  }
  throw new Error("--frontend-mode must be dev or preview");
}

function printHelp() {
  console.log(`Usage:
  autoresearch dev [stack options]
  autoresearch run [stack options]

Stack options:
  --convex-url URL        Convex deployment URL.
  --frontend-port N       Frontend port.
  --frontend-mode MODE    dev or preview.
  --no-reuse              Force a fresh Convex process.
  --no-workers            Disable the worker supervisor.
  --worker-poll-ms N      Worker supervisor polling interval.`);
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || "session";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
