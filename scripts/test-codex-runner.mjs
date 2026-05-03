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
  prepareTikzSourceForCompilation,
  storeConfiguredArtifacts
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
  assert.match(prompt, /\\usetikzlibrary\{calc\}/);
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

const tikzCalcTestRoot = mkdtempSync(join(tmpdir(), "autoresearch-runner-tikz-calc-test-"));
try {
  const sourcePath = join(tikzCalcTestRoot, "model_architecture.tex");
  const outputDir = join(tikzCalcTestRoot, "out");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    sourcePath,
    [
      "\\documentclass[tikz,border=7pt]{standalone}",
      "\\usetikzlibrary{positioning,fit,backgrounds}",
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "\\node (queries) {Queries};",
      "\\node[below] at ($(queries.south west)+(0mm,-15mm)$) {Lookahead};",
      "\\end{tikzpicture}",
      "\\end{document}",
      ""
    ].join("\n"),
    "utf8"
  );

  const compilePath = prepareTikzSourceForCompilation(sourcePath, outputDir);
  const patched = readFileSync(compilePath, "utf8");
  assert.notEqual(compilePath, sourcePath);
  assert.match(patched, /\\usetikzlibrary\{positioning,fit,backgrounds,calc\}/);
  assert.doesNotMatch(readFileSync(sourcePath, "utf8"), /\\usetikzlibrary\{positioning,fit,backgrounds,calc\}/);
} finally {
  rmSync(tikzCalcTestRoot, { recursive: true, force: true });
}

const configuredArtifactTestRoot = mkdtempSync(join(tmpdir(), "autoresearch-runner-artifact-test-"));
try {
  const artifactPath = join(configuredArtifactTestRoot, "artifacts", "validation.png");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const mutations = [];
  const ids = await storeConfiguredArtifacts({
    client: {
      mutation: async (_mutation, args) => {
        mutations.push(args);
        return `artifact-${mutations.length}`;
      }
    },
    session: {
      artifactContract: {
        artifacts: [
          {
            path: "artifacts/validation.png",
            kind: "validation_actual_vs_predicted_png",
            mimeType: "image/png",
            sourcePath: "plot.py"
          },
          {
            path: "artifacts/optional.png",
            kind: "optional_plot_png",
            mimeType: "image/png",
            required: false
          }
        ]
      }
    },
    runId: "run-id",
    workspacePath: configuredArtifactTestRoot
  });

  assert.deepEqual(ids, ["artifact-1"]);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, "artifacts/validation.png");
  assert.equal(mutations[0].sourcePath, "plot.py");
  assert.equal(mutations[0].mimeType, "image/png");
  assert.equal(mutations[0].byteLength, 4);
} finally {
  rmSync(configuredArtifactTestRoot, { recursive: true, force: true });
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
  const shared = join(patchTestRoot, "shared");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(workspace, "prepared"), { recursive: true });
  mkdirSync(shared, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "runner-test@example.local"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Runner Test"], { cwd: workspace });
  writeFileSync(join(workspace, "train.py"), "print('base')\n", "utf8");
  writeFileSync(join(workspace, "prepared", "latent_forecast_dataset.pt"), "checkout tensor\n", "utf8");
  writeFileSync(join(shared, "latent_forecast_dataset.pt"), "shared tensor\n", "utf8");
  execFileSync("git", ["add", "train.py", "prepared"], { cwd: workspace });
  execFileSync("git", ["commit", "-m", "base"], { cwd: workspace, stdio: "ignore" });

  writeFileSync(join(workspace, "train.py"), "print('changed')\n", "utf8");
  applyWorkspaceLinks(workspace, [{ workspacePath: "prepared", targetPath: shared }]);
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

  const patch = collectPatch(
    workspace,
    {
      editablePaths: ["train.py"],
      workspaceLinks: [{ workspacePath: "prepared", targetPath: shared }]
    },
    "HEAD"
  );
  assert.deepEqual(patch.changedFiles, ["train.py"]);
  assert.deepEqual(patch.rejectedFiles, []);
} finally {
  rmSync(patchTestRoot, { recursive: true, force: true });
}
