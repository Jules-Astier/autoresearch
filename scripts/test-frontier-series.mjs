import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tmpRoot = join(process.cwd(), ".autoresearch", "tmp");
mkdirSync(tmpRoot, { recursive: true });
const outDir = mkdtempSync(join(tmpRoot, "frontier-series-"));

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
      "--jsx",
      "react-jsx",
      "--skipLibCheck",
      "--outDir",
      outDir,
      "src/v2/frontierSeries.ts",
    ],
    { stdio: "inherit" },
  );

  const { buildMetricSeries, metricFocusedAtOrdinal } = await import(pathToFileURL(join(outDir, "frontierSeries.js")));
  const points = [
    point(34, { old_metric: 1.1, new_metric: 2.65 }, true),
    point(35, { old_metric: 0.0002, new_metric: 2.25 }, false),
    point(36, { old_metric: 0.0002, new_metric: 2.22 }, false),
  ];
  const series = buildMetricSeries(
    {
      name: "new_metric",
      direction: "maximize",
      measured: points.length,
      color: "orange",
    },
    points,
    "minimize",
    [
      { metric: "old_metric", startOrdinal: 1 },
      { metric: "new_metric", startOrdinal: 35 },
    ],
    (index) => index,
    (_metricName, value) => value,
  );

  assert.deepEqual(
    series.bestSegments.map((segment) => segment.path),
    ["M 0 2.65 L 1 2.65", "M 1 2.65 L 2 2.65"],
  );

  const focusEras = [
    { metric: "old_metric", startOrdinal: 1 },
    { metric: "new_metric", startOrdinal: 35 },
  ];
  assert.equal(metricFocusedAtOrdinal("new_metric", 34, focusEras), false);
  assert.equal(metricFocusedAtOrdinal("old_metric", 34, focusEras), true);
  assert.equal(metricFocusedAtOrdinal("new_metric", 35, focusEras), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function point(ordinal, metrics, promoted) {
  return {
    ordinal,
    value: metrics.new_metric,
    runningBest: metrics.new_metric,
    metrics,
    promoted,
    isHighWater: promoted,
    experimentId: `e${ordinal}`,
    sourceCount: 0,
  };
}
