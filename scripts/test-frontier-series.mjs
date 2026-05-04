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

  const { buildFocusEras, buildMetricSeries, metricFocusedAtOrdinal, metricHasPositiveDomain, metricPromotedAtOrdinal } = await import(pathToFileURL(join(outDir, "frontierSeries.js")));
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

  const derivedFocusEras = buildFocusEras({
    fallbackMetric: "new_metric",
    metricContract: {
      primaryMetric: "new_metric",
      metrics: [
        { name: "new_metric", direction: "maximize", role: "objective" },
        {
          name: "old_metric",
          direction: "minimize",
          role: "constraint",
          guardrail: { source: "best_experiment", sourceMetric: "old_metric" },
        },
      ],
    },
    experiments: [
      { _id: "e34", ordinal: 34, promoted: true, metrics: { old_metric: 1.1, new_metric: 2.65 }, createdAtUtc: "2026-01-01T00:34:00.000Z" },
      { _id: "e35", ordinal: 35, promoted: false, metrics: { old_metric: 0.0002, new_metric: 2.25 }, createdAtUtc: "2026-01-01T00:35:00.000Z" },
      { _id: "e36", ordinal: 36, promoted: false, metrics: { old_metric: 0.0002, new_metric: 2.22 }, createdAtUtc: "2026-01-01T00:36:00.000Z" },
    ],
    events: [
      {
        type: "metric_policy.switched",
        createdAtUtc: "2026-01-01T00:35:00.000Z",
        payload: { toObjective: "new_metric" },
      },
    ],
  });

  assert.deepEqual(derivedFocusEras, [
    { metric: "old_metric", startOrdinal: 34 },
    { metric: "new_metric", startOrdinal: 34.000001 },
  ]);
  assert.equal(metricFocusedAtOrdinal("old_metric", 34, derivedFocusEras), true);
  assert.equal(metricFocusedAtOrdinal("new_metric", 35, derivedFocusEras), true);

  const noEventFocusEras = buildFocusEras({
    fallbackMetric: "new_metric",
    metricContract: {
      primaryMetric: "new_metric",
      metrics: [
        { name: "new_metric", direction: "maximize", role: "objective" },
        {
          name: "old_metric",
          direction: "minimize",
          role: "constraint",
          guardrail: { source: "best_experiment", sourceMetric: "old_metric" },
        },
      ],
    },
    experiments: [
      { _id: "e34", ordinal: 34, promoted: true, metrics: { old_metric: 1.1, new_metric: 2.65 } },
      { _id: "e35", ordinal: 35, promoted: true, metrics: { old_metric: 0.0002, new_metric: 2.25 } },
      { _id: "e39", ordinal: 39, promoted: true, metrics: { old_metric: 0.0001, new_metric: 2.2 } },
      { _id: "e43", ordinal: 43, promoted: true, metrics: { old_metric: 0.01, new_metric: 2.7 } },
    ],
    events: [],
  });

  assert.deepEqual(noEventFocusEras, [
    { metric: "old_metric", startOrdinal: 34 },
    { metric: "new_metric", startOrdinal: 39.000001 },
  ]);
  assert.equal(metricFocusedAtOrdinal("old_metric", 39, noEventFocusEras), true);
  assert.equal(metricFocusedAtOrdinal("new_metric", 43, noEventFocusEras), true);
  const promotionPoints = [
    point(34, { old_metric: 1.1, new_metric: 2.65 }, true),
    point(35, { old_metric: 0.0002, new_metric: 2.25 }, true),
    point(39, { old_metric: 0.0001, new_metric: 2.2 }, true),
    point(43, { old_metric: 0.01, new_metric: 2.7 }, true),
  ];
  assert.equal(metricPromotedAtOrdinal("old_metric", 34, promotionPoints, "minimize", noEventFocusEras), true);
  assert.equal(metricPromotedAtOrdinal("old_metric", 35, promotionPoints, "minimize", noEventFocusEras), true);
  assert.equal(metricPromotedAtOrdinal("old_metric", 39, promotionPoints, "minimize", noEventFocusEras), true);
  assert.equal(metricPromotedAtOrdinal("old_metric", 43, promotionPoints, "minimize", noEventFocusEras), false);
  assert.equal(metricPromotedAtOrdinal("new_metric", 35, promotionPoints, "maximize", noEventFocusEras), false);
  assert.equal(metricPromotedAtOrdinal("new_metric", 43, promotionPoints, "maximize", noEventFocusEras), true);
  assert.equal(metricHasPositiveDomain("new_metric", points), true);
  assert.equal(metricHasPositiveDomain("old_metric", points), true);

  const mixedLogPoints = [
    point(1, { positive_metric: 1, zero_metric: 0 }, false),
    point(2, { positive_metric: 10, zero_metric: 0 }, true),
    point(3, { positive_metric: 100, zero_metric: 0 }, false),
  ];
  assert.equal(metricHasPositiveDomain("positive_metric", mixedLogPoints), true);
  assert.equal(metricHasPositiveDomain("zero_metric", mixedLogPoints), false);

  const zeroCrossingLogPoints = [
    point(1, { selected_metric: 0 }, false),
    point(2, { selected_metric: 1.5 }, true),
  ];
  assert.equal(metricHasPositiveDomain("selected_metric", zeroCrossingLogPoints), true);
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
