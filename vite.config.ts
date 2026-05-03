import { spawn } from "node:child_process";
import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), localFolderPicker()]
});

function localFolderPicker(): Plugin {
  function install(server: ViteDevServer | PreviewServer) {
    server.middlewares.use("/api/local/pick-directory", (req, res) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method !== "POST") {
        writeJson(res, 405, { error: "Use POST for directory selection." });
        return;
      }

      void pickDirectory()
        .then((directoryPath) => writeJson(res, 200, { path: directoryPath }))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
        writeJson(res, 500, { error: message });
      });
    });

    server.middlewares.use("/api/local/read-session-directory", (req, res) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method !== "POST") {
        writeJson(res, 405, { error: "Use POST to read a session directory." });
        return;
      }

      void readJsonBody(req)
        .then((body) => {
          const sessionDir = String(body?.path ?? "").trim();
          if (!sessionDir) {
            throw new Error("Missing session directory path.");
          }
          return readSessionDirectory(sessionDir);
        })
        .then((payload) => writeJson(res, 200, { payload }))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          writeJson(res, 400, { error: message });
        });
    });

    server.middlewares.use("/api/local/sync-metric-contract", (req, res) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method !== "POST") {
        writeJson(res, 405, { error: "Use POST to sync a session metric contract." });
        return;
      }

      void readJsonBody(req)
        .then((body) => {
          const sessionDir = String(body?.path ?? "").trim();
          if (!sessionDir) {
            throw new Error("Missing session directory path.");
          }
          return syncMetricContract(sessionDir);
        })
        .then((payload) => writeJson(res, 200, payload))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          writeJson(res, 400, { error: message });
        });
    });
  }

  return {
    name: "autoresearch-local-folder-picker",
    configureServer: install,
    configurePreviewServer: install,
  };
}

async function pickDirectory(): Promise<string | null> {
  if (process.platform === "darwin") {
    return runPickerCommand("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Select the Autoresearch session folder")',
    ]);
  }

  if (process.platform === "win32") {
    return runPickerCommand("powershell.exe", [
      "-NoProfile",
      "-STA",
      "-Command",
      [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
        '$dialog.Description = "Select the Autoresearch session folder";',
        "$dialog.ShowNewFolderButton = $false;",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
        "  [Console]::WriteLine($dialog.SelectedPath)",
        "}",
      ].join(" "),
    ]);
  }

  const commands = [
    {
      command: "zenity",
      args: ["--file-selection", "--directory", "--title=Select the Autoresearch session folder"],
    },
    {
      command: "kdialog",
      args: ["--getexistingdirectory", os.homedir(), "Select the Autoresearch session folder"],
    },
    {
      command: "yad",
      args: ["--file-selection", "--directory", "--title=Select the Autoresearch session folder"],
    },
  ];

  const errors: string[] = [];
  for (const candidate of commands) {
    try {
      return await runPickerCommand(candidate.command, candidate.args);
    } catch (error) {
      if (isMissingCommand(error)) {
        errors.push(candidate.command);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `No desktop folder picker was found. Install one of: ${errors.join(", ")}.`,
  );
}

function readSessionDirectory(sessionDir: string): Promise<unknown> {
  const root = process.cwd();
  const resolvedSessionDir = path.resolve(sessionDir);
  const binPath = path.join(root, "bin", "autoresearch.mjs");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      binPath,
      "register",
      resolvedSessionDir,
      "--dry-run",
    ], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `autoresearch register exited with ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(
          error instanceof Error
            ? new Error(`Could not parse session contract: ${error.message}`)
            : error,
        );
      }
    });
  });
}

function syncMetricContract(sessionDir: string): Promise<Record<string, unknown>> {
  const root = process.cwd();
  const resolvedSessionDir = path.resolve(sessionDir);
  const binPath = path.join(root, "bin", "autoresearch.mjs");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      binPath,
      "session",
      "sync-metric-contract",
      resolvedSessionDir,
    ], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `autoresearch sync exited with ${code}`));
        return;
      }
      resolve({
        path: resolvedSessionDir,
        output: stdout.trim(),
      });
    });
  });
}

function runPickerCommand(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const trimmed = stdout.trim();
      if (code === 0) {
        resolve(trimmed || null);
        return;
      }

      if (code === 1 && isLikelyPickerCancel(stderr)) {
        resolve(null);
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("error", reject);
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
  });
}

function isLikelyPickerCancel(stderr: string): boolean {
  const message = stderr.toLowerCase();
  return (
    message.length === 0 ||
    message.includes("user canceled") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

function isMissingCommand(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function writeJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: Record<string, unknown>,
) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
