import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { Lineage } from "./lineageTree";

type Props = {
  lineage: Lineage;
  selectedExperimentId?: string;
  onSelect: (experimentId: string) => void;
};

const ROW = 56;            // vertical spacing between trunk nodes
const TRUNK_X = 140;        // x of the trunk
const TOP_PAD = 60;
const BRANCH_SEG = 78;      // distance between branch nodes along the angled line
const BRANCH_ANGLES_DEG = [32, 48, 22, 60, 38];  // fanned angles for stacked branches at same point

const VIEW_H = 620;          // canvas pixel height
const MIN_VBW = 320;
const MAX_VBW = 6000;

export function Lineage({ lineage, selectedExperimentId, onSelect }: Props) {
  const layout = useMemo(() => layoutLineage(lineage), [lineage]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: VIEW_H });
  const [viewBox, setViewBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 800,
    h: VIEW_H,
  });
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const handledWheelEventsRef = useRef<WeakSet<WheelEvent>>(new WeakSet());
  const [hasFitted, setHasFitted] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        setContainerSize({ w, h });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // initial focus: newest trunk node centered, ~12 trunk nodes visible
  useEffect(() => {
    if (hasFitted) return;
    if (layout.trunk.length === 0) return;
    if (containerSize.w === 0) return;
    const last = layout.trunk[layout.trunk.length - 1];
    const targetWorldH = ROW * 12;
    const aspect = containerSize.w / containerSize.h;
    const w = targetWorldH * aspect;
    const h = targetWorldH;
    setViewBox({
      x: TRUNK_X - 80,
      y: last.y - h * 0.78, // newest near the bottom of viewport
      w,
      h,
    });
    setHasFitted(true);
  }, [layout, containerSize, hasFitted]);

  const hasLineage = lineage.trunk.length > 0 || lineage.branches.length > 0;

  function panFromWheel(e: WheelEvent, canvasEl: HTMLDivElement) {
    if (handledWheelEventsRef.current.has(e)) return;
    handledWheelEventsRef.current.add(e);
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = normalizeWheelDelta(e.deltaX, e.deltaMode, rect.width);
    const dy = normalizeWheelDelta(e.deltaY, e.deltaMode, rect.height);
    // shift+wheel often means horizontal panning on non-trackpad devices.
    const panX = e.shiftKey && dx === 0 ? dy : dx;
    const panY = e.shiftKey && dx === 0 ? 0 : dy;
    const vb = viewBoxRef.current;
    const worldDx = (panX / rect.width) * vb.w;
    const worldDy = (panY / rect.height) * vb.h;
    setViewBox({ ...vb, x: vb.x + worldDx, y: vb.y + worldDy });
  }

  // wheel-to-pan: trap wheel events on the whole canvas so the page doesn't scroll.
  // Using a native non-passive listener because React's synthetic onWheel may be passive.
  useEffect(() => {
    const currentEl = containerRef.current;
    if (!currentEl || !hasLineage) return;
    const canvasEl: HTMLDivElement = currentEl;
    function onWheel(e: WheelEvent) {
      panFromWheel(e, canvasEl);
    }
    canvasEl.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => canvasEl.removeEventListener("wheel", onWheel, { capture: true });
  }, [hasLineage]);

  // drag-to-pan: bind move/up to window so leaving the SVG doesn't strand state.
  function startPan(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    setIsPanning(true);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startVb = { ...viewBoxRef.current };
    const rect = svgRef.current!.getBoundingClientRect();
    function onMove(ev: PointerEvent) {
      const dxWorld = ((ev.clientX - startClientX) / rect.width) * startVb.w;
      const dyWorld = ((ev.clientY - startClientY) / rect.height) * startVb.h;
      setViewBox({ ...startVb, x: startVb.x - dxWorld, y: startVb.y - dyWorld });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setIsPanning(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function fitToTrunk(focusNewest = true) {
    if (layout.trunk.length === 0) return;
    const targetWorldH = ROW * 12;
    const aspect = containerSize.w / containerSize.h;
    const w = targetWorldH * aspect;
    const h = targetWorldH;
    if (focusNewest) {
      const last = layout.trunk[layout.trunk.length - 1];
      setViewBox({ x: TRUNK_X - 80, y: last.y - h * 0.78, w, h });
    } else {
      const first = layout.trunk[0];
      setViewBox({ x: TRUNK_X - 80, y: first.y - 40, w, h });
    }
  }
  function zoomBy(factor: number) {
    // zoom around viewport center
    const vb = viewBoxRef.current;
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    const newW = clamp(vb.w * factor, MIN_VBW, MAX_VBW);
    const ratio = newW / vb.w;
    const newH = vb.h * ratio;
    setViewBox({ x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH });
  }

  if (!hasLineage) {
    return (
      <div className="lineage-canvas" style={{ height: 200 }}>
        <p className="empty">no experiments yet — request a batch from the planner.</p>
      </div>
    );
  }

  // detail-text visibility: only show full hypothesis labels when zoomed in
  const zoom = containerSize.w / viewBox.w; // px per world-unit
  const showLabels = zoom > 0.6;
  const showHypText = zoom > 1.0;

  return (
    <div
      className="lineage-canvas"
      ref={containerRef}
      style={{ height: VIEW_H, userSelect: isPanning ? "none" : undefined }}
      onWheelCapture={(e) => {
        if (containerRef.current && hasLineage) panFromWheel(e.nativeEvent, containerRef.current);
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        preserveAspectRatio="xMinYMid meet"
        width="100%"
        height="100%"
        onPointerDown={startPan}
        style={{ cursor: isPanning ? "grabbing" : "grab", display: "block", touchAction: "none" }}
        role="img"
        aria-label="Experiment lineage canvas"
      >
        {/* trunk vertical line */}
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

        {/* best path glow: amber line from origin up to the best node */}
        {layout.bestY !== undefined ? (
          <line
            x1={TRUNK_X}
            y1={layout.trunk[0].y}
            x2={TRUNK_X}
            y2={layout.bestY}
            stroke="var(--amber)"
            strokeWidth={4}
            strokeOpacity={0.28}
            strokeLinecap="round"
          />
        ) : null}

        {/* dead branches at angles */}
        {layout.branches.map((b, i) => (
          <BranchPaint
            key={i}
            branch={b}
            selectedExperimentId={selectedExperimentId}
            onSelect={onSelect}
            showText={showHypText}
            showLabels={showLabels}
          />
        ))}

        {/* trunk nodes on top */}
        {layout.trunk.map((tn) => (
          <TrunkNode
            key={tn.experimentId}
            point={tn}
            selected={tn.experimentId === selectedExperimentId}
            onSelect={onSelect}
            showLabel={showLabels}
            showHyp={showHypText}
          />
        ))}
      </svg>

      <div className="lineage-controls" aria-hidden="true">
        <button type="button" className="lineage-ctrl" onClick={() => zoomBy(1 / 1.25)} title="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" className="lineage-ctrl" onClick={() => zoomBy(1.25)} title="Zoom out">
          <Minus size={14} />
        </button>
        <button type="button" className="lineage-ctrl" onClick={() => fitToTrunk(true)} title="Focus latest">
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="lineage-legend mono" aria-label="legend">
        <span className="lg lg-running"><i /> running</span>
        <span className="lg lg-promoted"><i /> promoted</span>
        <span className="lg lg-completed"><i /> completed</span>
        <span className="lg lg-queued"><i /> queued</span>
        <span className="lg lg-failed"><i /> failed</span>
        <span className="lg lg-rolled"><i /> rolled back</span>
      </div>

      <div className="lineage-hint mono">drag or scroll to pan · buttons to zoom</div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

type LayoutTrunkPoint = {
  experimentId: string;
  ordinal: number;
  status: string;
  hypothesis: string;
  promoted: boolean;
  isCurrent: boolean;
  isBest: boolean;
  x: number;
  y: number;
};

type LayoutBranch = {
  branchPointX?: number;
  branchPointY?: number;
  angleDeg: number;
  rolledBackOrdinalLabel: string;
  nodes: Array<{
    experimentId: string;
    ordinal: number;
    status: string;
    hypothesis: string;
    x: number;
    y: number;
  }>;
};

function layoutLineage(lineage: Lineage): {
  trunk: LayoutTrunkPoint[];
  branches: LayoutBranch[];
  bestY?: number;
} {
  const trunkPoints: LayoutTrunkPoint[] = lineage.trunk.map((n, i) => ({
    experimentId: n.experiment._id,
    ordinal: n.experiment.ordinal,
    status: n.experiment.status,
    hypothesis: n.experiment.hypothesis,
    promoted: n.isPromoted,
    isCurrent: n.isCurrent,
    isBest: n.isBest,
    x: TRUNK_X,
    y: TOP_PAD + i * ROW,
  }));
  const trunkById = new Map(trunkPoints.map((t) => [t.experimentId, t]));

  // count branches per branch-point so we can fan their angles
  const branchesByBP = new Map<string, number>();
  const branchPlacements: LayoutBranch[] = [];

  for (const branch of lineage.branches) {
    const bpId = branch.branchPointExperimentId;
    const bp = bpId ? trunkById.get(bpId) : undefined;
    const stackIndex = branchesByBP.get(bpId ?? "") ?? 0;
    branchesByBP.set(bpId ?? "", stackIndex + 1);
    const angleDeg = BRANCH_ANGLES_DEG[stackIndex % BRANCH_ANGLES_DEG.length];
    const angleRad = (angleDeg * Math.PI) / 180;

    const startX = bp?.x ?? TRUNK_X;
    const startY = bp?.y ?? TOP_PAD;

    const nodes = branch.nodes.map((n, i) => ({
      experimentId: n.experiment._id,
      ordinal: n.experiment.ordinal,
      status: n.experiment.status,
      hypothesis: n.experiment.hypothesis,
      x: startX + Math.cos(angleRad) * BRANCH_SEG * (i + 1),
      y: startY + Math.sin(angleRad) * BRANCH_SEG * (i + 1),
    }));

    const ords = branch.nodes.map((n) => n.experiment.ordinal);
    const rolledBackOrdinalLabel =
      ords.length === 0
        ? ""
        : ords.length === 1
          ? `#${ords[0]}`
          : `#${ords[0]}–#${ords[ords.length - 1]}`;

    branchPlacements.push({
      branchPointX: bp?.x,
      branchPointY: bp?.y,
      angleDeg,
      rolledBackOrdinalLabel,
      nodes,
    });
  }

  const bestNode = trunkPoints.find((t) => t.isBest) ?? trunkPoints.find((t) => t.promoted);
  return {
    trunk: trunkPoints,
    branches: branchPlacements,
    bestY: bestNode?.y,
  };
}

type NodeStyle = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
};

function styleForTrunkNode(point: LayoutTrunkPoint): NodeStyle {
  // running takes precedence — it pulses and is always amber
  if (point.isCurrent || point.status === "running" || point.status === "claimed") {
    return { fill: "var(--amber)", stroke: "transparent", strokeWidth: 0 };
  }
  if (point.promoted) {
    return { fill: "var(--moss)", stroke: "transparent", strokeWidth: 0 };
  }
  if (point.status === "failed" || point.status === "errored") {
    return { fill: "var(--oxblood)", stroke: "transparent", strokeWidth: 0 };
  }
  if (point.status === "queued" || point.status === "pending") {
    // open paper circle with ink ring — clearly "not yet a fact"
    return { fill: "var(--paper-2)", stroke: "var(--ink-4)", strokeWidth: 1.5, strokeDasharray: "3 3" };
  }
  if (point.status === "completed") {
    // not promoted, not failed — completed-but-meh (light moss)
    return { fill: "var(--moss-faded)", stroke: "transparent", strokeWidth: 0 };
  }
  return { fill: "var(--ink-4)", stroke: "transparent", strokeWidth: 0 };
}

function TrunkNode({
  point,
  selected,
  onSelect,
  showLabel,
  showHyp,
}: {
  point: LayoutTrunkPoint;
  selected: boolean;
  onSelect: (id: string) => void;
  showLabel: boolean;
  showHyp: boolean;
}) {
  const isRunning = point.isCurrent || point.status === "running" || point.status === "claimed";
  const style = styleForTrunkNode(point);
  const r = isRunning ? 9 : point.promoted || point.isBest ? 8 : 6.5;
  const labelX = point.x + 18;

  return (
    <g
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(point.experimentId);
      }}
      style={{ cursor: "pointer" }}
    >
      {selected ? (
        <circle cx={point.x} cy={point.y} r={r + 6} fill="none" stroke="var(--ink-1)" strokeWidth={1.5} />
      ) : null}
      {isRunning ? (
        <circle cx={point.x} cy={point.y} r={r + 5} fill="var(--amber)" opacity={0.18}>
          <animate attributeName="r" values={`${r + 5};${r + 12};${r + 5}`} dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.18;0.04;0.18" dur="1.8s" repeatCount="indefinite" />
        </circle>
      ) : null}
      <circle
        cx={point.x}
        cy={point.y}
        r={r}
        fill={style.fill}
        stroke={point.isBest ? "var(--amber)" : style.stroke}
        strokeWidth={point.isBest ? 2.5 : style.strokeWidth}
        strokeDasharray={style.strokeDasharray}
      >
        <title>{`#${point.ordinal} · ${point.status}${point.promoted ? " · promoted" : ""}${point.isBest ? " · best" : ""} · ${point.hypothesis}`}</title>
      </circle>
      {showLabel ? (
        <text className="node-label" x={labelX} y={point.y - 4}>
          #{point.ordinal}
          {point.isBest ? " ★" : ""}
          {point.promoted && !point.isBest ? " ✓" : ""}
        </text>
      ) : null}
      {showHyp ? (
        <text className="node-hyp" x={labelX} y={point.y + 14}>
          {truncate(point.hypothesis, 56)}
        </text>
      ) : null}
    </g>
  );
}

function BranchPaint({
  branch,
  selectedExperimentId,
  onSelect,
  showText,
  showLabels,
}: {
  branch: LayoutBranch;
  selectedExperimentId?: string;
  onSelect: (id: string) => void;
  showText: boolean;
  showLabels: boolean;
}) {
  if (branch.nodes.length === 0) return null;
  const last = branch.nodes[branch.nodes.length - 1];
  const startX = branch.branchPointX ?? branch.nodes[0].x;
  const startY = branch.branchPointY ?? branch.nodes[0].y;

  const labelDX = 14;

  return (
    <g>
      {/* angled stem from trunk to last branch node */}
      <line
        x1={startX}
        y1={startY}
        x2={last.x}
        y2={last.y}
        stroke="var(--sepia-soft)"
        strokeWidth={1.75}
        strokeDasharray="4 4"
      />
      {/* branch tag (rolled-back range), placed near branch start */}
      {showLabels && branch.nodes.length > 0 ? (
        <text
          className="branch-tag"
          x={startX + Math.cos((branch.angleDeg * Math.PI) / 180) * 18}
          y={startY + Math.sin((branch.angleDeg * Math.PI) / 180) * 18 - 6}
          fill="var(--sepia)"
        >
          ↶ {branch.rolledBackOrdinalLabel}
        </text>
      ) : null}

      {branch.nodes.map((n) => (
        <g
          key={n.experimentId}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(n.experimentId);
          }}
          style={{ cursor: "pointer" }}
        >
          <circle
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
          {showLabels ? (
            <text className="node-label" x={n.x + labelDX} y={n.y - 3} fill="var(--sepia)">
              #{n.ordinal}
            </text>
          ) : null}
          {showText ? (
            <text className="node-hyp dim" x={n.x + labelDX} y={n.y + 12}>
              {truncate(n.hypothesis, 30)}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
