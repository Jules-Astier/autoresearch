import { useMemo } from "react";
import type { Lineage } from "./lineageTree";

type Props = {
  lineage: Lineage;
  selectedExperimentId?: string;
  onSelect: (experimentId: string) => void;
};

const ROW = 64;
const TRUNK_X = 60;
const BRANCH_COL_GAP = 110;
const BRANCH_COL_OFFSET = 90;
const TOP_PAD = 32;
const LABEL_GAP = 22;

export function Lineage({ lineage, selectedExperimentId, onSelect }: Props) {
  const layout = useMemo(() => layoutLineage(lineage), [lineage]);

  if (lineage.trunk.length === 0 && lineage.branches.length === 0) {
    return (
      <div className="lineage">
        <p className="empty">no experiments yet — request a batch from the planner.</p>
      </div>
    );
  }

  return (
    <div className="lineage" aria-label="Experiment lineage">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
      >
        {/* trunk connecting line */}
        {layout.trunk.length > 1 ? (
          <line
            x1={TRUNK_X}
            y1={layout.trunk[0].y}
            x2={TRUNK_X}
            y2={layout.trunk[layout.trunk.length - 1].y}
            stroke="var(--moss-faded)"
            strokeWidth={2}
          />
        ) : null}

        {/* best-path glow: amber line from first trunk node up to best */}
        {layout.bestPath ? (
          <line
            x1={TRUNK_X}
            y1={layout.trunk[0].y}
            x2={TRUNK_X}
            y2={layout.bestPath.y}
            stroke="var(--amber)"
            strokeWidth={3.5}
            strokeOpacity={0.32}
            strokeLinecap="round"
          />
        ) : null}

        {/* dead branches */}
        {layout.branches.map((b, i) => (
          <BranchPaint
            key={i}
            branchPlacement={b}
            selectedExperimentId={selectedExperimentId}
            onSelect={onSelect}
          />
        ))}

        {/* trunk nodes — drawn after lines so they sit on top */}
        {layout.trunk.map((tn) => (
          <TrunkNode
            key={tn.experimentId}
            point={tn}
            selected={tn.experimentId === selectedExperimentId}
            onSelect={onSelect}
            labelMaxWidth={layout.labelMaxWidth}
          />
        ))}
      </svg>
    </div>
  );
}

type LayoutTrunkPoint = {
  experimentId: string;
  ordinal: number;
  status: string;
  hypothesis: string;
  promoted: boolean;
  isCurrent: boolean;
  isBest: boolean;
  isDead: false;
  x: number;
  y: number;
};

type LayoutBranchPoint = {
  experimentId: string;
  ordinal: number;
  status: string;
  hypothesis: string;
  isDead: true;
  x: number;
  y: number;
};

type LayoutBranch = {
  branchPointY?: number;
  startY: number;
  x: number;
  nodes: LayoutBranchPoint[];
  rolledBackOrdinalLabel: string;
};

type Layout = {
  width: number;
  height: number;
  trunk: LayoutTrunkPoint[];
  branches: LayoutBranch[];
  bestPath?: { y: number };
  labelMaxWidth: number;
};

function layoutLineage(lineage: Lineage): Layout {
  const trunkPoints: LayoutTrunkPoint[] = lineage.trunk.map((n, i) => ({
    experimentId: n.experiment._id,
    ordinal: n.experiment.ordinal,
    status: n.experiment.status,
    hypothesis: n.experiment.hypothesis,
    promoted: n.isPromoted,
    isCurrent: n.isCurrent,
    isBest: n.isBest,
    isDead: false,
    x: TRUNK_X,
    y: TOP_PAD + i * ROW,
  }));

  const trunkById = new Map(trunkPoints.map((t) => [t.experimentId, t]));

  // pack branches into columns greedily
  const columnsBottom: number[] = [];
  const branchPlacements: LayoutBranch[] = [];

  for (const branch of lineage.branches) {
    const bp = branch.branchPointExperimentId
      ? trunkById.get(branch.branchPointExperimentId)
      : undefined;
    const branchPointY = bp?.y;
    const startY = (branchPointY ?? TOP_PAD) + ROW * 0.5;

    let col = 0;
    while (col < columnsBottom.length && columnsBottom[col] >= startY - 8) col++;
    if (col === columnsBottom.length) columnsBottom.push(0);

    const nodes: LayoutBranchPoint[] = branch.nodes.map((n, i) => ({
      experimentId: n.experiment._id,
      ordinal: n.experiment.ordinal,
      status: n.experiment.status,
      hypothesis: n.experiment.hypothesis,
      isDead: true,
      x: TRUNK_X + BRANCH_COL_OFFSET + col * BRANCH_COL_GAP,
      y: startY + i * ROW,
    }));

    columnsBottom[col] = nodes.length > 0 ? nodes[nodes.length - 1].y : startY;

    const ords = branch.nodes.map((n) => n.experiment.ordinal);
    const rolledBackOrdinalLabel =
      ords.length === 0
        ? ""
        : ords.length === 1
          ? `#${ords[0]}`
          : `#${ords[0]}–#${ords[ords.length - 1]}`;

    branchPlacements.push({
      branchPointY,
      startY,
      x: nodes[0]?.x ?? TRUNK_X + BRANCH_COL_OFFSET + col * BRANCH_COL_GAP,
      nodes,
      rolledBackOrdinalLabel,
    });
  }

  const branchColumnCount = columnsBottom.length;
  const labelLaneStartX =
    TRUNK_X + BRANCH_COL_OFFSET + Math.max(branchColumnCount, 1) * BRANCH_COL_GAP + LABEL_GAP;

  const lastTrunkY =
    trunkPoints.length > 0 ? trunkPoints[trunkPoints.length - 1].y : TOP_PAD;
  const lastBranchY = columnsBottom.length > 0 ? Math.max(...columnsBottom) : 0;
  const height = Math.max(lastTrunkY, lastBranchY) + TOP_PAD;
  const width = labelLaneStartX + 320;

  // best-path indicator
  const bestNode = trunkPoints.find((t) => t.isBest) ?? trunkPoints.find((t) => t.promoted);
  const bestPath = bestNode ? { y: bestNode.y } : undefined;

  return {
    width,
    height,
    trunk: trunkPoints,
    branches: branchPlacements,
    bestPath,
    labelMaxWidth: 300,
  };
}

function TrunkNode({
  point,
  selected,
  onSelect,
  labelMaxWidth,
}: {
  point: LayoutTrunkPoint;
  selected: boolean;
  onSelect: (id: string) => void;
  labelMaxWidth: number;
}) {
  const baseColor = point.isCurrent
    ? "var(--amber)"
    : point.promoted
      ? "var(--moss)"
      : point.status === "failed"
        ? "var(--oxblood)"
        : "var(--moss-faded)";
  const r = point.isCurrent ? 9 : point.promoted || point.isBest ? 8 : 6.5;
  const labelX = point.x + 22;

  const hyp = truncate(point.hypothesis, 64);

  return (
    <g
      onClick={() => onSelect(point.experimentId)}
      style={{ cursor: "pointer" }}
    >
      {/* selection ring */}
      {selected ? (
        <circle
          cx={point.x}
          cy={point.y}
          r={r + 5}
          fill="none"
          stroke="var(--ink-1)"
          strokeWidth={1.5}
        />
      ) : null}
      {/* current pulse */}
      {point.isCurrent ? (
        <circle
          cx={point.x}
          cy={point.y}
          r={r + 4}
          fill="var(--amber)"
          opacity={0.18}
        >
          <animate
            attributeName="r"
            values={`${r + 4};${r + 10};${r + 4}`}
            dur="1.8s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.18;0.04;0.18"
            dur="1.8s"
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
      <circle
        className="node-circle"
        cx={point.x}
        cy={point.y}
        r={r}
        fill={baseColor}
        stroke={point.isBest ? "var(--amber)" : "transparent"}
        strokeWidth={point.isBest ? 2.5 : 0}
      >
        <title>{`#${point.ordinal} · ${point.status} · ${point.hypothesis}`}</title>
      </circle>
      <text
        className="node-label"
        x={labelX}
        y={point.y - 6}
      >
        #{point.ordinal}
        {point.isBest ? " ★" : ""}
        {point.promoted && !point.isBest ? " ✓" : ""}
      </text>
      <text
        className={`node-hyp ${point.isCurrent ? "" : ""}`}
        x={labelX}
        y={point.y + 12}
      >
        {hyp}
      </text>
    </g>
  );
}

function BranchPaint({
  branchPlacement,
  selectedExperimentId,
  onSelect,
}: {
  branchPlacement: LayoutBranch;
  selectedExperimentId?: string;
  onSelect: (id: string) => void;
}) {
  const { nodes, branchPointY, x, rolledBackOrdinalLabel } = branchPlacement;
  if (nodes.length === 0) return null;

  // path: from trunk branch point down-right to first branch node
  const firstY = nodes[0].y;
  const lastY = nodes[nodes.length - 1].y;

  const stub =
    branchPointY !== undefined
      ? `M ${TRUNK_X} ${branchPointY} C ${TRUNK_X} ${branchPointY + 24}, ${x} ${firstY - 24}, ${x} ${firstY}`
      : `M ${x} ${firstY - 16} L ${x} ${firstY}`;

  return (
    <g>
      <path d={stub} fill="none" stroke="var(--sepia-soft)" strokeWidth={1.75} />
      {nodes.length > 1 ? (
        <line
          x1={x}
          y1={firstY}
          x2={x}
          y2={lastY}
          stroke="var(--sepia-soft)"
          strokeWidth={1.75}
        />
      ) : null}

      {nodes.map((n) => (
        <g
          key={n.experimentId}
          onClick={() => onSelect(n.experimentId)}
          style={{ cursor: "pointer" }}
        >
          <circle
            className="node-circle"
            cx={n.x}
            cy={n.y}
            r={selectedExperimentId === n.experimentId ? 7 : 5}
            fill="var(--paper-1)"
            stroke="var(--sepia)"
            strokeWidth={1.75}
            strokeDasharray="2 2"
          >
            <title>{`#${n.ordinal} · rolled back · ${n.hypothesis}`}</title>
          </circle>
          <text className="node-label" x={n.x + 14} y={n.y - 5} fill="var(--sepia)">
            #{n.ordinal}
          </text>
          <text className="node-hyp dim" x={n.x + 14} y={n.y + 11}>
            {truncate(n.hypothesis, 32)}
          </text>
        </g>
      ))}

      {/* branch tag near top */}
      <text
        className="branch-tag"
        x={x - 4}
        y={firstY - 14}
      >
        ↶ {rolledBackOrdinalLabel}
      </text>
    </g>
  );
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
