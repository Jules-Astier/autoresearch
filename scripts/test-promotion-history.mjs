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

  const { promotionMilestoneIdsForSession } = await import(
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
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
