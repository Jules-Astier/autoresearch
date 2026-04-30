import { spawn } from "node:child_process";
import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), localFolderPicker()]
});

function localFolderPicker(): Plugin {
  function install(server: ViteDevServer | PreviewServer) {
    server.middlewares.use("/api/local/pick-directory", (req, res, next) => {
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
      'POSIX path of (choose folder with prompt "Select the base workspace folder")',
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
        '$dialog.Description = "Select the base workspace folder";',
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
      args: ["--file-selection", "--directory", "--title=Select the base workspace folder"],
    },
    {
      command: "kdialog",
      args: ["--getexistingdirectory", os.homedir(), "Select the base workspace folder"],
    },
    {
      command: "yad",
      args: ["--file-selection", "--directory", "--title=Select the base workspace folder"],
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
