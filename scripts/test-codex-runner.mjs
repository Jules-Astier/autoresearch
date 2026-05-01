import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAgentPrompt } from "./codex-runner.mjs";

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
  assert.match(prompt, /create figures\/model_architecture\.tex/);
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}
