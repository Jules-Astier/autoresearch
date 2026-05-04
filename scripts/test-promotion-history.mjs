import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "tenx-promotion-history-"));

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "--target",
      "ES2022",
      "--module",
      "ES2022",
      "--moduleResolution",
      "Bundler",
      "--skipLibCheck",
      "--outDir",
      outDir,
      "convex/promotionHistory.ts",
    ],
    { stdio: "inherit" },
  );

  const { promotionMilestoneIdsForDisplay, promotionMilestoneIdsForSession } = await import(
    pathToFileURL(join(outDir, "promotionHistory.js"))
  );
  const contract = {
    primaryMetric: "loss",
    metrics: [{ name: "loss", direction: "minimize" }],
  };
  const ids = promotionMilestoneIdsForSession(contract, [
    { id: "e1", ordinal: 1, status: "completed", metrics: { loss: 0.5 } },
    { id: "e2", ordinal: 2, status: "completed", metrics: { loss: 0.4 } },
    { id: "e3", ordinal: 3, status: "completed", metrics: { loss: 0.45 } },
    { id: "e4", ordinal: 4, status: "completed", metrics: { loss: 0.35 } },
  ]);

  assert.deepEqual([...ids], ["e1", "e2", "e4"]);

  const orderedContract = {
    rankingMode: "lexicographic",
    metrics: [
      { name: "loss", direction: "minimize", role: "objective", tolerance: 0.01 },
      { name: "accuracy", direction: "maximize", role: "objective" },
      { name: "latency_ms", direction: "minimize", role: "constraint", max: 30 },
    ],
  };
  const orderedIds = promotionMilestoneIdsForSession(orderedContract, [
    {
      id: "l1",
      ordinal: 1,
      status: "completed",
      metrics: { loss: 0.5, accuracy: 0.8, latency_ms: 20 },
    },
    {
      id: "l2",
      ordinal: 2,
      status: "completed",
      metrics: { loss: 0.505, accuracy: 0.82, latency_ms: 29 },
    },
    {
      id: "l3",
      ordinal: 3,
      status: "completed",
      metrics: { loss: 0.505, accuracy: 0.83, latency_ms: 35 },
    },
    {
      id: "l4",
      ordinal: 4,
      status: "completed",
      metrics: { loss: 0.49, accuracy: 0.81, latency_ms: 30 },
    },
  ]);

  assert.deepEqual([...orderedIds], ["l1", "l2", "l4"]);

  const switchedContract = {
    rankingMode: "lexicographic",
    primaryMetric: "new_metric",
    metrics: [
      { name: "new_metric", direction: "maximize", role: "objective" },
      {
        name: "old_metric",
        direction: "minimize",
        role: "constraint",
        max: 0.4,
        guardrail: {
          source: "best_experiment",
          sourceMetric: "old_metric",
          allowedRegression: 0,
        },
      },
    ],
  };
  const switchedIds = promotionMilestoneIdsForDisplay(
    switchedContract,
    [
      { id: "s1", ordinal: 1, status: "completed", metrics: { old_metric: 0.8, new_metric: 0.1 } },
      { id: "s2", ordinal: 2, status: "completed", metrics: { old_metric: 0.5, new_metric: 0.2 } },
      { id: "s3", ordinal: 3, status: "completed", metrics: { old_metric: 0.6, new_metric: 0.3 } },
      { id: "s4", ordinal: 4, status: "completed", metrics: { old_metric: 0.4, new_metric: 0.4 } },
      { id: "s5", ordinal: 5, status: "completed", metrics: { old_metric: 0.4, new_metric: 0.6 } },
    ],
    [
      {
        type: "metric_policy.switched",
        createdAtUtc: "2026-01-01T00:00:00.000Z",
        payload: {
          fromObjective: "old_metric",
          toObjective: "new_metric",
          sourceExperimentId: "s4",
        },
      },
    ],
  );

  assert.deepEqual([...switchedIds], ["s1", "s2", "s4"]);

  const persistedSwitchedIds = promotionMilestoneIdsForDisplay(
    switchedContract,
    [
      { id: "p1", ordinal: 1, status: "completed", metrics: { old_metric: 0.8, new_metric: 0.1 }, promoted: true },
      { id: "p2", ordinal: 2, status: "completed", metrics: { old_metric: 0.5, new_metric: 0.2 }, promoted: true },
      { id: "p3", ordinal: 3, status: "completed", metrics: { old_metric: 0.4, new_metric: 0.3 }, promoted: false },
    ],
    [
      {
        type: "metric_policy.switched",
        createdAtUtc: "2026-01-01T00:00:00.000Z",
        payload: {
          fromObjective: "old_metric",
          toObjective: "new_metric",
          sourceExperimentId: "p3",
        },
      },
    ],
  );

  assert.deepEqual([...persistedSwitchedIds], ["p1", "p2", "p3"]);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
