// Derive a tree structure for the lineage canvas from the data the existing
// Convex queries already return. We don't read `dagNodes` (would require a
// new query); instead we use rollbacks + experiment ordinals.
//
// Result: a trunk of live experiments (in chronological order), plus a list
// of dead branches — each rooted at the rollback target experiment, holding
// the experiments that were pruned by that rollback.

import type { ExperimentSource } from "./sources";

export type ExperimentLite = {
  _id: string;
  ordinal: number;
  status: string;
  hypothesis: string;
  metrics?: Record<string, number>;
  promoted: boolean;
  score?: number;
  createdAtUtc?: string;
  activeRunId?: string;
  sources?: ExperimentSource[];
};

export type RollbackLite = {
  _id?: string;
  targetExperimentId?: string;
  rolledBackExperimentIds: string[];
  fromExperimentOrdinal?: number;
  toExperimentOrdinal?: number;
  reason?: string;
  createdAtUtc?: string;
};

export type LineageNode = {
  experiment: ExperimentLite;
  isOnTrunk: boolean;
  isDead: boolean;
  isPromoted: boolean;
  isCurrent: boolean;
  isBest: boolean;
};

export type DeadBranch = {
  rollback: RollbackLite;
  branchPointExperimentId?: string;  // where it forks off the trunk
  nodes: LineageNode[];              // chronological order
};

export type Lineage = {
  trunk: LineageNode[];
  branches: DeadBranch[];
  bestExperimentId?: string;
};

export function buildLineage(
  experiments: ExperimentLite[],
  rollbacks: RollbackLite[],
  bestExperimentId?: string,
  activeExperimentId?: string,
): Lineage {
  const sortedExperiments = [...experiments].sort((a, b) => a.ordinal - b.ordinal);
  const byId = new Map(sortedExperiments.map((e) => [e._id, e]));

  // every experiment id mentioned in any rollback's rolledBackExperimentIds
  const rolledBackSet = new Set<string>();
  for (const r of rollbacks) {
    for (const id of r.rolledBackExperimentIds ?? []) {
      rolledBackSet.add(id);
    }
  }

  const node = (e: ExperimentLite, isOnTrunk: boolean, isDead: boolean): LineageNode => ({
    experiment: e,
    isOnTrunk,
    isDead,
    isPromoted: Boolean(e.promoted),
    isCurrent: e._id === activeExperimentId,
    isBest: bestExperimentId !== undefined && e._id === bestExperimentId,
  });

  const trunk: LineageNode[] = sortedExperiments
    .filter((e) => !rolledBackSet.has(e._id))
    .map((e) => node(e, true, false));

  const branches: DeadBranch[] = rollbacks
    .filter((r) => (r.rolledBackExperimentIds ?? []).length > 0)
    .map((r) => {
      const branchNodes = (r.rolledBackExperimentIds ?? [])
        .map((id) => byId.get(id))
        .filter((e): e is ExperimentLite => Boolean(e))
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((e) => node(e, false, true));
      return {
        rollback: r,
        branchPointExperimentId: r.targetExperimentId,
        nodes: branchNodes,
      };
    })
    .filter((b) => b.nodes.length > 0);

  return { trunk, branches, bestExperimentId };
}
