import { GitBranch } from "lucide-react";
import type { DagNode } from "../types";

type PromotionGraphProps = {
  dag: DagNode[];
};

const NODE_R = 14;
const X_STEP = 130;
const Y = 80;
const X_START = 60;

export function PromotionGraph({ dag }: PromotionGraphProps) {
  const nodes = dag.map((node, index) => ({
    id: String(node.experiment_id ?? node.run_id ?? node.hash ?? `node-${index}`),
    label: String(node.experiment_id ?? node.run_id ?? node.hash ?? `node-${index}`).slice(0, 14),
    promoted: Boolean(node.promoted ?? node.is_master),
    hypothesis: String(node.hypothesis ?? ""),
    x: X_START + index * X_STEP,
    y: Y
  }));
  const width = Math.max(720, nodes.length * X_STEP + X_START * 2);
  const promotedCount = nodes.filter((n) => n.promoted).length;

  return (
    <section className="overflow-hidden rounded-lg border border-ink-800/70 bg-ink-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-ink-800/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-800/80 ring-1 ring-ink-700/50">
            <GitBranch className="h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-ink-50">Promotion lineage</h2>
            <p className="text-[11px] text-ink-500">
              {nodes.length} nodes · {promotedCount} promoted
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-[11px] text-ink-400 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> promoted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink-500" /> candidate
          </span>
        </div>
      </header>

      <div className="overflow-x-auto p-2">
        {nodes.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-ink-500">
            No DAG metadata.
          </div>
        ) : (
          <svg width={width} height="180" role="img" className="block">
            <defs>
              <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3f3f46" />
                <stop offset="100%" stopColor="#52525b" />
              </linearGradient>
            </defs>

            {/* Edges */}
            {nodes.slice(1).map((node, index) => {
              const prev = nodes[index];
              return (
                <line
                  key={`${prev.id}-${node.id}`}
                  x1={prev.x + NODE_R}
                  y1={prev.y}
                  x2={node.x - NODE_R}
                  y2={node.y}
                  stroke="url(#edge)"
                  strokeWidth="2"
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => (
              <g key={node.id}>
                {node.promoted ? (
                  <circle cx={node.x} cy={node.y} r={NODE_R + 4} fill="#10b981" opacity="0.12" />
                ) : null}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_R}
                  fill={node.promoted ? "#10b981" : "#3f3f46"}
                  stroke={node.promoted ? "#34d399" : "#52525b"}
                  strokeWidth="1.5"
                >
                  <title>{node.hypothesis || node.id}</title>
                </circle>
                {node.promoted ? (
                  <path
                    d={`M ${node.x - 5},${node.y} L ${node.x - 1},${node.y + 4} L ${node.x + 5},${node.y - 4}`}
                    stroke="#09090b"
                    strokeWidth="2.2"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
                <text
                  x={node.x}
                  y={node.y + NODE_R + 18}
                  textAnchor="middle"
                  className="fill-zinc-400 font-mono text-[10px]"
                >
                  {node.label}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}
