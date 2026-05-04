import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  ChartNoAxesCombined,
  ClipboardList,
  ExternalLink,
  GitBranch,
  Grip,
  LayoutGrid,
  ListPlus,
  Maximize2,
  Minimize2,
  NotebookText,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import "./dashboardEditor.css";

type WidgetKind =
  | "frontier"
  | "agents"
  | "hypothesis"
  | "lineage"
  | "ledger"
  | "notes"
  | "metrics"
  | "artifacts";

type LayoutRow = {
  id: string;
  height: number;
};

type LayoutCell = {
  id: string;
  widget?: WidgetKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type WidgetOption = {
  kind: WidgetKind;
  title: string;
  group: string;
  icon: typeof ChartNoAxesCombined;
  description: string;
};

type MergeDirection = "left" | "right" | "up" | "down";

const COLS = 20;
const MIN_CELL_W = 5;
const DEFAULT_ROW_HEIGHT = 3;
const MIN_ROW_HEIGHT = 2;
const DEFAULT_HORIZONTAL_GAP = 6;
const DEFAULT_VERTICAL_GAP = 10;

const WIDGETS: WidgetOption[] = [
  { kind: "frontier", title: "Frontier", group: "Progress", icon: ChartNoAxesCombined, description: "Metric landscape and current best run." },
  { kind: "hypothesis", title: "Hypothesis now", group: "Progress", icon: Sparkles, description: "Active experiment, objective, and worker focus." },
  { kind: "metrics", title: "Metric priority", group: "Session", icon: SlidersHorizontal, description: "Objective order, guardrails, and best values." },
  { kind: "agents", title: "Agents", group: "Agents", icon: Bot, description: "Planner, reviewer, worker, and memory activity." },
  { kind: "lineage", title: "Lineage", group: "Experiments", icon: GitBranch, description: "Trunk, branches, promotions, and rollbacks." },
  { kind: "ledger", title: "Ledger", group: "Experiments", icon: ClipboardList, description: "Experiment table with status and deltas." },
  { kind: "notes", title: "Notes", group: "Memory", icon: NotebookText, description: "Research memory and durable findings." },
  { kind: "artifacts", title: "Artifacts", group: "Outputs", icon: Activity, description: "Generated plots, diffs, and benchmark outputs." },
];

const SAMPLE_ROWS: LayoutRow[] = [
  { id: "row-1", height: DEFAULT_ROW_HEIGHT },
  { id: "row-2", height: DEFAULT_ROW_HEIGHT },
  { id: "row-3", height: DEFAULT_ROW_HEIGHT },
];

const SAMPLE_CELLS: LayoutCell[] = [
  { id: "cell-1", title: "Empty cell", x: 0, y: 0, w: COLS, h: 1 },
  { id: "cell-2", title: "Empty cell", x: 0, y: 1, w: COLS, h: 1 },
  { id: "cell-3", title: "Empty cell", x: 0, y: 2, w: COLS, h: 1 },
];

const SAMPLE_VALUES: Record<WidgetKind, string[]> = {
  frontier: ["horizon_target_rmse 0.2952", "best #267", "stalled - 24 experiments"],
  agents: ["planner running", "2 workers active", "memory idle"],
  hypothesis: ["reweighted trend filtering", "budget 05:00", "working #293"],
  lineage: ["118 trunk nodes", "7 branches", "rollback ready"],
  ledger: ["#291 accepted", "#292 measured", "#293 running"],
  notes: ["duplicate avoided", "dataset caveat", "next angle"],
  metrics: ["primary rmse", "guardrail calibration", "minimize"],
  artifacts: ["forecast_plot.png", "patch.diff", "stdout.json"],
};

export function DashboardEditor() {
  const gridRef = useRef<HTMLDivElement>(null);
  const suppressNextCellClick = useRef(false);
  const [rows, setRows] = useState<LayoutRow[]>(SAMPLE_ROWS);
  const [cells, setCells] = useState<LayoutCell[]>(SAMPLE_CELLS);
  const [selectedCellId, setSelectedCellId] = useState("cell-1");
  const [catalogCellId, setCatalogCellId] = useState<string | null>(null);
  const [horizontalGap, setHorizontalGap] = useState(DEFAULT_HORIZONTAL_GAP);
  const [verticalGap, setVerticalGap] = useState(DEFAULT_VERTICAL_GAP);
  const [gridUnit, setGridUnit] = useState(48);
  const [activeRowResize, setActiveRowResize] = useState<string | null>(null);

  const rowGeometry = useMemo(() => buildRowGeometry(rows), [rows]);
  const totalUnits = rowGeometry.totalUnits;
  const panelCount = cells.filter((cell) => cell.widget).length;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const updateGridUnit = () => setGridUnit(getGridUnit(grid));
    updateGridUnit();
    const observer = new ResizeObserver(updateGridUnit);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  function resetLayout() {
    setRows(SAMPLE_ROWS);
    setCells(SAMPLE_CELLS);
    setSelectedCellId("cell-1");
    setCatalogCellId(null);
  }

  function addRow() {
    const rowIndex = rows.length;
    const row: LayoutRow = { id: `row-${Date.now()}`, height: DEFAULT_ROW_HEIGHT };
    const cell: LayoutCell = { id: `cell-${Date.now()}`, title: "Empty cell", x: 0, y: rowIndex, w: COLS, h: 1 };
    setRows((current) => [...current, row]);
    setCells((current) => [...current, cell]);
    setSelectedCellId(cell.id);
  }

  function deleteRow(rowIndex: number) {
    if (rows.length === 1) return;
    setRows((current) => current.filter((_, index) => index !== rowIndex));
    setCells((current) => {
      const next = current.flatMap((cell) => {
        if (cell.y > rowIndex) return [{ ...cell, y: cell.y - 1 }];
        if (cell.y + cell.h <= rowIndex) return [cell];
        if (cell.y <= rowIndex && cell.y + cell.h > rowIndex + 1) return [{ ...cell, h: cell.h - 1 }];
        return [];
      });
      setSelectedCellId(next[0]?.id ?? "");
      return next.length > 0 ? next : [{ id: `cell-${Date.now()}`, title: "Empty cell", x: 0, y: 0, w: COLS, h: 1 }];
    });
  }

  function placeWidget(kind: WidgetKind, cellId: string) {
    const widget = WIDGETS.find((item) => item.kind === kind);
    if (!widget) return;
    setCells((current) =>
      current.map((cell) => (cell.id === cellId ? { ...cell, widget: kind, title: widget.title } : cell)),
    );
    setSelectedCellId(cellId);
    setCatalogCellId(null);
  }

  function removeWidget(cellId: string) {
    setCells((current) =>
      current.map((cell) => (cell.id === cellId ? { ...cell, widget: undefined, title: "Empty cell" } : cell)),
    );
  }

  function deleteCell(cellId: string) {
    const cellToDelete = cells.find((item) => item.id === cellId);
    if (cellToDelete?.w === COLS && cellToDelete.h === 1 && rows.length > 1) {
      deleteRow(cellToDelete.y);
      return;
    }

    setCells((current) => {
      const cell = current.find((item) => item.id === cellId);
      if (!cell) return current;

      const horizontalTarget = findMergeTarget(cell, current, "right") ?? findMergeTarget(cell, current, "left");
      if (horizontalTarget) {
        const merged = mergeRects(cell, horizontalTarget);
        setSelectedCellId(horizontalTarget.id);
        return current
          .filter((item) => item.id !== cell.id)
          .map((item) => (item.id === horizontalTarget.id ? { ...item, ...merged } : item));
      }

      const replacements = unmergeCellIntoRows(cell).map((replacement, index) => ({
        ...replacement,
        id: `${cell.id}-deleted-${index}-${Date.now()}`,
        widget: undefined,
        title: "Empty cell",
      }));
      setSelectedCellId(replacements[0]?.id ?? "");
      return current.filter((item) => item.id !== cell.id).concat(replacements);
    });
  }

  function unmergeCell(cellId: string) {
    setCells((current) => {
      const cell = current.find((item) => item.id === cellId);
      if (!cell || cell.h <= 1) return current;
      const replacements = unmergeCellIntoRows(cell).map((replacement, index) => ({
        ...replacement,
        id: `${cell.id}-unmerged-${index}-${Date.now()}`,
        widget: index === 0 ? cell.widget : undefined,
        title: index === 0 ? cell.title : "Empty cell",
      }));
      setSelectedCellId(replacements[0]?.id ?? cell.id);
      return current.filter((item) => item.id !== cell.id).concat(replacements);
    });
  }

  function resizeRow(rowIndex: number, delta: number) {
    setRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, height: Math.max(MIN_ROW_HEIGHT, row.height + delta) } : row,
      ),
    );
  }

  function splitCell(cellId: string) {
    setCells((current) => {
      const cell = current.find((item) => item.id === cellId);
      if (!cell || cell.w < MIN_CELL_W * 2) return current;

      const leftW = Math.max(MIN_CELL_W, Math.floor(cell.w / 2));
      const rightW = cell.w - leftW;
      const nextCell: LayoutCell = {
        id: `cell-${Date.now()}`,
        title: "Empty cell",
        x: cell.x + leftW,
        y: cell.y,
        w: rightW,
        h: cell.h,
      };
      setSelectedCellId(nextCell.id);
      return current.map((item) => (item.id === cell.id ? { ...item, w: leftW } : item)).concat(nextCell);
    });
  }

  function mergeCell(cellId: string, direction: MergeDirection) {
    setCells((current) => {
      const cell = current.find((item) => item.id === cellId);
      if (!cell) return current;
      const target = findMergeTarget(cell, current, direction);
      if (!target) return current;
      const merged = mergeRects(cell, target);
      setSelectedCellId(cell.id);
      return current
        .filter((item) => item.id !== target.id)
        .map((item) => (item.id === cell.id ? { ...item, ...merged } : item));
    });
  }

  function resizeBoundary(cellId: string, edge: "left" | "right", delta: number) {
    if (delta === 0) return;
    setCells((current) => {
      const cell = current.find((item) => item.id === cellId);
      if (!cell) return current;
      const group = findVerticalBoundaryResizeGroup(cell, current, edge);
      if (!group) return current;

      const leftCells = current.filter((item) => group.leftIds.has(item.id));
      const rightCells = current.filter((item) => group.rightIds.has(item.id));
      if (leftCells.some((item) => item.w + delta < MIN_CELL_W)) return current;
      if (rightCells.some((item) => item.w - delta < MIN_CELL_W)) return current;

      return current.map((item) => {
        if (group.leftIds.has(item.id)) return { ...item, w: item.w + delta };
        if (group.rightIds.has(item.id)) return { ...item, x: item.x + delta, w: item.w - delta };
        return item;
      });
    });
  }

  function startColumnResize(cellId: string, edge: "left" | "right", event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    suppressNextCellClick.current = true;
    const startX = event.clientX;
    const colWidth = getGridUnit(grid);
    let applied = 0;

    const onMove = (moveEvent: PointerEvent) => {
      const totalDelta = Math.round((moveEvent.clientX - startX) / colWidth);
      const nextDelta = totalDelta - applied;
      if (nextDelta === 0) return;
      applied += nextDelta;
      resizeBoundary(cellId, edge, nextDelta);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.setTimeout(() => {
        suppressNextCellClick.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startRowResize(rowIndex: number, event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    suppressNextCellClick.current = true;
    const startY = event.clientY;
    const rowUnit = getGridUnit(grid);
    let applied = 0;

    const onMove = (moveEvent: PointerEvent) => {
      const totalDelta = Math.round((moveEvent.clientY - startY) / rowUnit);
      const nextDelta = totalDelta - applied;
      if (nextDelta === 0) return;
      applied += nextDelta;
      resizeRow(rowIndex, nextDelta);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.setTimeout(() => {
        suppressNextCellClick.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startRowTopResize(rowIndex: number, event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    suppressNextCellClick.current = true;
    const startY = event.clientY;
    const rowUnit = getGridUnit(grid);
    let applied = 0;

    const onMove = (moveEvent: PointerEvent) => {
      const totalDelta = Math.round((moveEvent.clientY - startY) / rowUnit);
      const nextDelta = totalDelta - applied;
      if (nextDelta === 0) return;
      applied += nextDelta;
      resizeRow(rowIndex, -nextDelta);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.setTimeout(() => {
        suppressNextCellClick.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function moveCell(cellId: string, direction: -1 | 1) {
    setCells((current) => {
      const cell = current.find((item) => item.id === cellId);
      if (!cell) return current;
      const target = direction === -1 ? findMergeTarget(cell, current, "left") : findMergeTarget(cell, current, "right");
      if (!target) return current;
      return current.map((item) => {
        if (item.id === cell.id) return { ...item, x: target.x, w: target.w };
        if (item.id === target.id) return { ...item, x: cell.x, w: cell.w };
        return item;
      });
    });
  }

  return (
    <div className="dashboard-editor lab-ledger">
      <div className="page">
        <header className="header editor-dashboard-header">
          <div>
            <span className="brand">
              autoresearch <span className="sub">- lab ledger</span>
            </span>
          </div>
          <div className="header-meta">
            <span className="heartbeat"><span className="dot" /> live</span>
            <span>updated just now</span>
            <a className="btn btn-quiet btn-console" href="/">
              <ExternalLink size={14} />
              live dashboard
            </a>
            <button type="button" className="btn" onClick={resetLayout}>
              <RotateCcw size={14} />
              reset
            </button>
          </div>
        </header>

        <div className="session-tape editor-session-tape" aria-label="Sessions">
          <div className="tape-label">sessions</div>
          <button type="button" className="session-pill active" data-status="running">
            <span className="glyph" />
            latent-forecaster-calibration-target-accuracy-xau-xag-h1-alt
          </button>
        </div>

        <div className="editor-bar">
          <div>
            <div className="editor-kicker">
              <LayoutGrid size={14} />
              rectangular 20-column placement grid
            </div>
            <p>
              Cells can split horizontally, resize against siblings, and merge across neighboring row bands when their columns align.
            </p>
          </div>
        </div>

        <div className="editor-shell">
          <main className="editor-workbench" aria-label="Dashboard layout editor">
            <div className="blueprint-meta">
              <span>{COLS} columns · {totalUnits} row units · min cell {MIN_CELL_W}</span>
              <span>{panelCount} panels · {rows.length} rows</span>
            </div>

            <div className="spacing-controls" aria-label="Grid spacing controls">
              <label>
                <span>horizontal gap</span>
                <input type="range" min="0" max="24" value={horizontalGap} onChange={(event) => setHorizontalGap(Number(event.target.value))} />
                <output>{horizontalGap}px</output>
              </label>
              <label>
                <span>vertical gap</span>
                <input type="range" min="0" max="32" value={verticalGap} onChange={(event) => setVerticalGap(Number(event.target.value))} />
                <output>{verticalGap}px</output>
              </label>
            </div>

            <div
              ref={gridRef}
              className="placement-grid"
              style={{
                "--h-gap": `${horizontalGap}px`,
                "--v-gap": `${verticalGap}px`,
                "--grid-unit": `${gridUnit}px`,
                gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${totalUnits}, var(--grid-unit))`,
              } as CSSProperties}
            >
              {rows.map((row, rowIndex) => {
                const y = rowGeometry.starts[rowIndex] ?? 0;
                return (
                  <div
                    key={row.id}
                    className="layout-row-frame"
                    style={{ gridColumn: `1 / span ${COLS}`, gridRow: `${y + 1} / span ${row.height}` }}
                  >
                    <div className="row-label">row {rowIndex + 1} · {row.height}</div>
                    <div className="row-controls">
                      <button type="button" className="tile-tool" title="Taller" onClick={() => resizeRow(rowIndex, 2)}><ArrowDown size={12} /></button>
                      <button type="button" className="tile-tool" title="Shorter" onClick={() => resizeRow(rowIndex, -2)}><ArrowUp size={12} /></button>
                      <button type="button" className="tile-tool danger" title="Delete row" onClick={() => deleteRow(rowIndex)}><Trash2 size={12} /></button>
                    </div>
                  </div>
                );
              })}

              {rows.flatMap((row, rowIndex) => {
                const boundaryRow = rowIndex + 1;
                const boundaryUnit = (rowGeometry.starts[rowIndex] ?? 0) + row.height;
                const bottomSegments = getRowResizeSegments(cells, boundaryRow, "bottom");
                const topSegments = rowIndex + 1 < rows.length
                  ? getRowResizeSegments(cells, boundaryRow, "top")
                  : [];
                return [
                  ...bottomSegments.map((segment) => (
                    <button
                      key={`row-resize-bottom-${row.id}-${segment.x}-${segment.w}`}
                      type="button"
                      className={`row-resize-handle bottom-edge ${activeRowResize === `bottom-${boundaryRow}` ? "active" : ""}`}
                      title="Resize row bottom"
                      style={{
                        gridColumn: `${segment.x + 1} / span ${segment.w}`,
                        gridRow: boundaryUnit + 1,
                      }}
                      onPointerEnter={() => setActiveRowResize(`bottom-${boundaryRow}`)}
                      onPointerLeave={() => setActiveRowResize(null)}
                      onFocus={() => setActiveRowResize(`bottom-${boundaryRow}`)}
                      onBlur={() => setActiveRowResize(null)}
                      onPointerDown={(event) => startRowResize(rowIndex, event)}
                    />
                  )),
                  ...topSegments.map((segment) => (
                    <button
                      key={`row-resize-top-${row.id}-${segment.x}-${segment.w}`}
                      type="button"
                      className={`row-resize-handle top-edge ${activeRowResize === `top-${boundaryRow}` ? "active" : ""}`}
                      title="Resize row top"
                      style={{
                        gridColumn: `${segment.x + 1} / span ${segment.w}`,
                        gridRow: boundaryUnit + 1,
                      }}
                      onPointerEnter={() => setActiveRowResize(`top-${boundaryRow}`)}
                      onPointerLeave={() => setActiveRowResize(null)}
                      onFocus={() => setActiveRowResize(`top-${boundaryRow}`)}
                      onBlur={() => setActiveRowResize(null)}
                      onPointerDown={(event) => startRowTopResize(rowIndex + 1, event)}
                    />
                  )),
                ];
              })}

              {cells.map((cell) => {
                const y = rowGeometry.starts[cell.y] ?? 0;
                const rowSpan = spanRows(rows, cell.y, cell.h);
                return (
                  <CellTile
                    key={cell.id}
                    cell={cell}
                    cells={cells}
                    rowSpan={rowSpan}
                    y={y}
                    selected={selectedCellId === cell.id}
                    onSelect={() => setSelectedCellId(cell.id)}
                    onPlace={() => setCatalogCellId(cell.id)}
                    onRemove={() => removeWidget(cell.id)}
                    onDelete={() => deleteCell(cell.id)}
                    onUnmerge={() => unmergeCell(cell.id)}
                    onSplit={() => splitCell(cell.id)}
                    onResize={(delta) => {
                      if (findVerticalBoundaryResizeGroup(cell, cells, "right")) resizeBoundary(cell.id, "right", delta);
                      else if (findVerticalBoundaryResizeGroup(cell, cells, "left")) resizeBoundary(cell.id, "left", -delta);
                    }}
                    onMerge={(direction) => mergeCell(cell.id, direction)}
                    onStartColumnResize={startColumnResize}
                    shouldSuppressClick={() => suppressNextCellClick.current}
                    onMove={(direction) => moveCell(cell.id, direction)}
                  />
                );
              })}
            </div>
            <button type="button" className="add-row-strip" onClick={addRow}>
              <Plus size={15} />
              add row
            </button>
          </main>
        </div>
      </div>

      {catalogCellId ? (
        <div className="catalog-overlay" role="dialog" aria-label="Choose widget">
          <div className="catalog-dialog">
            <div className="dialog-head">
              <div>
                <div className="editor-kicker">
                  <ListPlus size={14} />
                  place in selected cell
                </div>
                <h2>Place an instrument</h2>
              </div>
              <button type="button" className="btn icon-btn" onClick={() => setCatalogCellId(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <div className="widget-picker">
              {WIDGETS.map((widget) => {
                const Icon = widget.icon;
                return (
                  <button type="button" key={widget.kind} className="widget-option" onClick={() => placeWidget(widget.kind, catalogCellId)}>
                    <Icon size={18} />
                    <span>
                      <strong>{widget.title}</strong>
                      <small>{widget.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CellTile({
  cell,
  cells,
  rowSpan,
  y,
  selected,
  onSelect,
  onPlace,
  onRemove,
  onDelete,
  onUnmerge,
  onSplit,
  onResize,
  onMerge,
  onStartColumnResize,
  shouldSuppressClick,
  onMove,
}: {
  cell: LayoutCell;
  cells: LayoutCell[];
  rowSpan: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  onPlace: () => void;
  onRemove: () => void;
  onDelete: () => void;
  onUnmerge: () => void;
  onSplit: () => void;
  onResize: (delta: number) => void;
  onMerge: (direction: MergeDirection) => void;
  onStartColumnResize: (cellId: string, edge: "left" | "right", event: ReactPointerEvent) => void;
  shouldSuppressClick: () => boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const widget = cell.widget ? WIDGETS.find((item) => item.kind === cell.widget) : undefined;
  const Icon = widget?.icon;
  const hasLeftResize = Boolean(findVerticalBoundaryResizeGroup(cell, cells, "left"));
  const hasRightResize = Boolean(findVerticalBoundaryResizeGroup(cell, cells, "right"));
  const previousCell = findMergeTarget(cell, cells, "left");
  const nextCell = findMergeTarget(cell, cells, "right");
  const canSplit = cell.w >= MIN_CELL_W * 2;
  const canMergeUp = Boolean(findMergeTarget(cell, cells, "up"));
  const canMergeDown = Boolean(findMergeTarget(cell, cells, "down"));
  const canMergeLeft = Boolean(previousCell);
  const canMergeRight = Boolean(nextCell);
  const canUnmerge = cell.h > 1;

  const gridStyle = {
    gridColumn: `${cell.x + 1} / span ${cell.w}`,
    gridRow: `${y + 1} / span ${rowSpan}`,
  };

  if (!cell.widget || !Icon) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={`empty-cell-tile ${selected ? "selected" : ""}`}
        style={gridStyle}
        onClick={() => {
          if (shouldSuppressClick()) return;
          onSelect();
          onPlace();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
            onPlace();
          }
        }}
      >
        <CellControls
          canSplit={canSplit}
          canMergeUp={canMergeUp}
          canMergeDown={canMergeDown}
          canMergeLeft={canMergeLeft}
          canMergeRight={canMergeRight}
          canUnmerge={canUnmerge}
          onSplit={onSplit}
          onDelete={onDelete}
          onUnmerge={onUnmerge}
          onMerge={onMerge}
        />
        {hasLeftResize ? (
          <button type="button" className="cell-resize-handle left" title="Resize cell border" onPointerDown={(event) => onStartColumnResize(cell.id, "left", event)} onClick={(event) => event.stopPropagation()} />
        ) : null}
        {hasRightResize ? (
          <button type="button" className="cell-resize-handle right" title="Resize cell border" onPointerDown={(event) => onStartColumnResize(cell.id, "right", event)} onClick={(event) => event.stopPropagation()} />
        ) : null}
        <span className="cell-size-badge">{cell.w}x{cell.h}</span>
        <Plus size={18} />
      </div>
    );
  }

  return (
    <article className={`panel-tile panel-${cell.widget} ${selected ? "selected" : ""}`} style={gridStyle} onClick={onSelect}>
      <div className="cell-hover-toolbar panel-toolbar">
        <button type="button" className="drag-handle" title="Move handle" aria-label={`Move ${cell.title}`}>
          <Grip size={14} />
        </button>
        <button type="button" className="tile-tool" title="Split cell" disabled={!canSplit} onClick={(event) => { event.stopPropagation(); onSplit(); }}>|</button>
        <button type="button" className="tile-tool" title="Merge up" disabled={!canMergeUp} onClick={(event) => { event.stopPropagation(); onMerge("up"); }}><ArrowUp size={12} /></button>
        <button type="button" className="tile-tool" title="Merge down" disabled={!canMergeDown} onClick={(event) => { event.stopPropagation(); onMerge("down"); }}><ArrowDown size={12} /></button>
        <button type="button" className="tile-tool" title="Unmerge rows" disabled={!canUnmerge} onClick={(event) => { event.stopPropagation(); onUnmerge(); }}>U</button>
        <button type="button" className="tile-tool" title="Move left" onClick={(event) => { event.stopPropagation(); onMove(-1); }}><ArrowLeft size={12} /></button>
        <button type="button" className="tile-tool" title="Move right" onClick={(event) => { event.stopPropagation(); onMove(1); }}><ArrowRight size={12} /></button>
        <button type="button" className="tile-tool" title="Wider" onClick={(event) => { event.stopPropagation(); onResize(1); }}><Maximize2 size={12} /></button>
        <button type="button" className="tile-tool" title="Narrower" onClick={(event) => { event.stopPropagation(); onResize(-1); }}><Minimize2 size={12} /></button>
        <button type="button" className="tile-tool" title="Clear widget" onClick={(event) => { event.stopPropagation(); onRemove(); }}><X size={12} /></button>
        <button type="button" className="tile-tool danger" title="Remove cell" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={12} /></button>
      </div>
      {hasLeftResize ? (
        <button type="button" className="cell-resize-handle left" title="Resize cell border" onPointerDown={(event) => onStartColumnResize(cell.id, "left", event)} onClick={(event) => event.stopPropagation()} />
      ) : null}
      {hasRightResize ? (
        <button type="button" className="cell-resize-handle right" title="Resize cell border" onPointerDown={(event) => onStartColumnResize(cell.id, "right", event)} onClick={(event) => event.stopPropagation()} />
      ) : null}
      <span className="cell-size-badge">{cell.w}x{cell.h}</span>

      <div className="panel-head">
        <span className="panel-mark">
          <Icon size={15} />
        </span>
        <span>
          <strong>{cell.title}</strong>
          <small>
            col {cell.x + 1}-{cell.x + cell.w} · rows {cell.y + 1}-{cell.y + cell.h}
          </small>
        </span>
      </div>

      <div className={`mock-widget mock-${cell.widget}`}>
        {SAMPLE_VALUES[cell.widget].map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
    </article>
  );
}

function CellControls({
  canSplit,
  canMergeUp,
  canMergeDown,
  canMergeLeft,
  canMergeRight,
  canUnmerge,
  onSplit,
  onDelete,
  onUnmerge,
  onMerge,
}: {
  canSplit: boolean;
  canMergeUp: boolean;
  canMergeDown: boolean;
  canMergeLeft: boolean;
  canMergeRight: boolean;
  canUnmerge: boolean;
  onSplit: () => void;
  onDelete: () => void;
  onUnmerge: () => void;
  onMerge: (direction: MergeDirection) => void;
}) {
  return (
    <div className="cell-hover-toolbar">
      <button type="button" className="tile-tool" title="Split cell" disabled={!canSplit} onClick={(event) => { event.stopPropagation(); onSplit(); }}>|</button>
      <button type="button" className="tile-tool" title="Merge up" disabled={!canMergeUp} onClick={(event) => { event.stopPropagation(); onMerge("up"); }}><ArrowUp size={12} /></button>
      <button type="button" className="tile-tool" title="Merge down" disabled={!canMergeDown} onClick={(event) => { event.stopPropagation(); onMerge("down"); }}><ArrowDown size={12} /></button>
      <button type="button" className="tile-tool" title="Merge left" disabled={!canMergeLeft} onClick={(event) => { event.stopPropagation(); onMerge("left"); }}><ArrowLeft size={12} /></button>
      <button type="button" className="tile-tool" title="Merge right" disabled={!canMergeRight} onClick={(event) => { event.stopPropagation(); onMerge("right"); }}><ArrowRight size={12} /></button>
      <button type="button" className="tile-tool" title="Unmerge rows" disabled={!canUnmerge} onClick={(event) => { event.stopPropagation(); onUnmerge(); }}>U</button>
      <button type="button" className="tile-tool danger" title="Remove cell" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={12} /></button>
    </div>
  );
}

function buildRowGeometry(rows: LayoutRow[]) {
  const starts: Record<number, number> = {};
  let cursor = 0;
  rows.forEach((row, index) => {
    starts[index] = cursor;
    cursor += row.height;
  });
  return { starts, totalUnits: Math.max(cursor, DEFAULT_ROW_HEIGHT) };
}

function spanRows(rows: LayoutRow[], y: number, h: number) {
  return rows.slice(y, y + h).reduce((sum, row) => sum + row.height, 0);
}

function findMergeTarget(cell: LayoutCell, cells: LayoutCell[], direction: MergeDirection) {
  return cells.find((candidate) => {
    if (candidate.id === cell.id) return false;
    if (direction === "left") return candidate.y === cell.y && candidate.h === cell.h && candidate.x + candidate.w === cell.x;
    if (direction === "right") return candidate.y === cell.y && candidate.h === cell.h && cell.x + cell.w === candidate.x;
    if (direction === "up") return candidate.x === cell.x && candidate.w === cell.w && candidate.y + candidate.h === cell.y;
    return candidate.x === cell.x && candidate.w === cell.w && cell.y + cell.h === candidate.y;
  });
}

function findVerticalBoundaryResizeGroup(cell: LayoutCell, cells: LayoutCell[], edge: "left" | "right") {
  const boundary = edge === "right" ? cell.x + cell.w : cell.x;
  const boundaryCells = cells.filter(
    (candidate) => candidate.x + candidate.w === boundary || candidate.x === boundary,
  );
  if (!boundaryCells.some((candidate) => candidate.id === cell.id)) return null;

  const component = new Set<string>([cell.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of boundaryCells) {
      if (component.has(candidate.id)) continue;
      const touchesComponent = boundaryCells.some(
        (member) =>
          component.has(member.id) &&
          rangesOverlap(candidate.y, candidate.y + candidate.h, member.y, member.y + member.h),
      );
      if (touchesComponent) {
        component.add(candidate.id);
        changed = true;
      }
    }
  }

  const leftIds = new Set<string>();
  const rightIds = new Set<string>();
  for (const candidate of boundaryCells) {
    if (!component.has(candidate.id)) continue;
    if (candidate.x + candidate.w === boundary) leftIds.add(candidate.id);
    if (candidate.x === boundary) rightIds.add(candidate.id);
  }

  return leftIds.size > 0 && rightIds.size > 0 ? { boundary, leftIds, rightIds } : null;
}

function getRowResizeSegments(cells: LayoutCell[], boundaryRow: number, edge: "top" | "bottom") {
  const valid = Array.from({ length: COLS }, (_, x) =>
    cells.some((cell) => {
      const inCell = x >= cell.x && x < cell.x + cell.w;
      if (!inCell) return false;
      return edge === "bottom" ? cell.y + cell.h === boundaryRow : cell.y === boundaryRow;
    }),
  );

  const segments: Array<{ x: number; w: number }> = [];
  let start: number | undefined;
  for (let x = 0; x <= COLS; x += 1) {
    if (valid[x] && start === undefined) start = x;
    if ((!valid[x] || x === COLS) && start !== undefined) {
      segments.push({ x: start, w: x - start });
      start = undefined;
    }
  }
  return segments;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

function mergeRects(a: LayoutCell, b: LayoutCell) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function unmergeCellIntoRows(cell: LayoutCell) {
  return Array.from({ length: cell.h }, (_, index): LayoutCell => ({
    ...cell,
    y: cell.y + index,
    h: 1,
  }));
}

function getGridUnit(grid: HTMLDivElement) {
  const styles = window.getComputedStyle(grid);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  return Math.max(1, (grid.clientWidth - paddingLeft - paddingRight) / COLS);
}
