export type DirectedArchitectureRelation = {
  id: string;
  source: string;
  target: string;
};

export type ArchitectureTrace = {
  mode: "upstream" | "downstream" | "route";
  nodeIds: string[];
  edgeIds: string[];
};

function ordered(relations: DirectedArchitectureRelation[]) {
  return [...relations].sort((a, b) => a.id.localeCompare(b.id));
}

/** Traverse only authored directed relations; no inferred topology is added. */
export function traceArchitectureReach(
  relations: DirectedArchitectureRelation[],
  start: string,
  direction: "upstream" | "downstream",
): ArchitectureTrace {
  const seen = new Set([start]);
  const edgeIds = new Set<string>();
  const queue = [start];
  const candidates = ordered(relations);
  while (queue.length) {
    const current = queue.shift()!;
    for (const relation of candidates) {
      const next =
        direction === "downstream" && relation.source === current
          ? relation.target
          : direction === "upstream" && relation.target === current
            ? relation.source
            : null;
      if (!next) continue;
      edgeIds.add(relation.id);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return {
    mode: direction,
    nodeIds: [...seen],
    edgeIds: [...edgeIds],
  };
}

/** Find one shortest authored directed route with stable id-based tie breaking. */
export function traceArchitectureRoute(
  relations: DirectedArchitectureRelation[],
  start: string,
  target: string,
): ArchitectureTrace | null {
  if (start === target) return { mode: "route", nodeIds: [start], edgeIds: [] };
  const candidates = ordered(relations);
  const queue = [start];
  const visited = new Set([start]);
  const previous = new Map<
    string,
    { node: string; edge: DirectedArchitectureRelation }
  >();
  while (queue.length) {
    const current = queue.shift()!;
    for (const relation of candidates) {
      if (relation.source !== current || visited.has(relation.target)) continue;
      visited.add(relation.target);
      previous.set(relation.target, { node: current, edge: relation });
      if (relation.target === target) {
        const nodeIds = [target];
        const edgeIds: string[] = [];
        let cursor = target;
        while (cursor !== start) {
          const step = previous.get(cursor)!;
          edgeIds.unshift(step.edge.id);
          nodeIds.unshift(step.node);
          cursor = step.node;
        }
        return { mode: "route", nodeIds, edgeIds };
      }
      queue.push(relation.target);
    }
  }
  return null;
}
