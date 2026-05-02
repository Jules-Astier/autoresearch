import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  applyWorkspaceLinks,
  buildAgentPrompt,
  collectPatch,
  prepareTikzSourceForCompilation
} from "./codex-runner.mjs";

const workspacePath = mkdtempSync(join(tmpdir(), "autoresearch-runner-test-"));

try {
  const prompt = buildAgentPrompt({
    session: {
      title: "test session",
      benchmarkCommand: "python train.py",
      computeBudget: 60,
      targetExperimentCount: 3,
      metricContract: { metrics: [{ name: "loss", direction: "minimize" }] },
      editablePaths: ["train.py", "figures/**/*.tex"],
      runtimeConfigPaths: [],
      immutablePaths: ["data/**"],
      modelIoContract: "Preserve model inputs and outputs."
    },
    basePatch: null,
    experiment: {
      ordinal: 1,
      hypothesis: "Add a small architecture change.",
      changeKind: "architecture_change",
      prompt: "Update the architecture and matching diagram."
    },
    priorExperiments: [],
    workspacePath
  });

  assert.match(prompt, /directly use \$model-diagram-tikz/);
  assert.match(prompt, /standalone TikZ `\.tex` source/);
  assert.match(prompt, /\\usepackage\{amsfonts\}/);
  assert.match(prompt, /create figures\/model_architecture\.tex/);
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}

const tikzCompileTestRoot = mkdtempSync(join(tmpdir(), "autoresearch-runner-tikz-test-"));
try {
  const sourcePath = join(tikzCompileTestRoot, "model_architecture.tex");
  const outputDir = join(tikzCompileTestRoot, "out");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    sourcePath,
    [
      "\\documentclass[tikz,border=7pt]{standalone}",
      "\\usepackage[T1]{fontenc}",
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "\\node {Latent Vector\\\\$z \\in \\mathbb{R}^{32}$};",
      "\\end{tikzpicture}",
      "\\end{document}",
      ""
    ].join("\n"),
    "utf8"
  );

  const compilePath = prepareTikzSourceForCompilation(sourcePath, outputDir);
  assert.notEqual(compilePath, sourcePath);
  assert.match(readFileSync(compilePath, "utf8"), /\\usepackage\{amsfonts\}/);
  assert.doesNotMatch(readFileSync(sourcePath, "utf8"), /\\usepackage\{amsfonts\}/);
} finally {
  rmSync(tikzCompileTestRoot, { recursive: true, force: true });
}

const linkTestRoot = mkdtempSync(join(tmpdir(), "autoresearch-runner-links-test-"));
try {
  const workspace = join(linkTestRoot, "workspace");
  const shared = join(linkTestRoot, "shared");
  const targetPath = join(shared, "latent_forecast_dataset.pt");
  const workspacePath = "prepared/latent_forecast_dataset.pt";
  const linkPath = join(workspace, workspacePath);
  mkdirSync(join(workspace, "prepared"), { recursive: true });
  mkdirSync(shared, { recursive: true });
  writeFileSync(targetPath, "shared tensor\n", "utf8");
  writeFileSync(linkPath, "checkout tensor\n", "utf8");

  applyWorkspaceLinks(workspace, [{ workspacePath, targetPath }]);

  assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(readFileSync(linkPath, "utf8"), "shared tensor\n");
  assert.equal(readlinkSync(linkPath), targetPath);
} finally {
  rmSync(linkTestRoot, { recursive: true, force: true });
}

const patchTestRoot = mkdtempSync(join(tmpdir(), "autoresearch-runner-patch-test-"));
try {
  const workspace = join(patchTestRoot, "workspace");
  mkdirSync(workspace, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "runner-test@example.local"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Runner Test"], { cwd: workspace });
  writeFileSync(join(workspace, "train.py"), "print('base')\n", "utf8");
  execFileSync("git", ["add", "train.py"], { cwd: workspace });
  execFileSync("git", ["commit", "-m", "base"], { cwd: workspace, stdio: "ignore" });

  writeFileSync(join(workspace, "train.py"), "print('changed')\n", "utf8");
  const artifactPath = join(
    workspace,
    ".autoresearch",
    "sessions",
    "latent-forecaster-calibration-xau-xag-h1",
    "artifacts",
    "research",
    "autoresearch",
    "forecast",
    "summary.json"
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, "{}\n", "utf8");

  const patch = collectPatch(workspace, { editablePaths: ["train.py"] }, "HEAD");
  assert.deepEqual(patch.changedFiles, ["train.py"]);
  assert.deepEqual(patch.rejectedFiles, []);
} finally {
  rmSync(patchTestRoot, { recursive: true, force: true });
}
