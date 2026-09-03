import path from "node:path";
import type { ArchitectureGraph } from "../../shared/architecture";
import {
  buildArchitectureFederation,
  type ArchitectureFederation,
  type FederationApproval,
  type FederationCandidate,
  type FederationInput,
} from "../../shared/federation";
import type { WorkbenchState } from "../../shared/history";

const MAX_SELECTED_SNAPSHOTS = 11;

function rootKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Return only the newest immutable reading for each recent, inactive project. */
export function federationCandidates(
  state: WorkbenchState,
  activeRoot: string,
): FederationCandidate[] {
  const active = rootKey(activeRoot);
  const snapshots = new Map(
    state.snapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  return state.projects
    .filter(
      (project) =>
        rootKey(project.root) !== active &&
        project.latestSnapshotId &&
        snapshots.get(project.latestSnapshotId)?.workspaceRoot === project.root,
    )
    .sort(
      (left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt) ||
        left.root.localeCompare(right.root),
    )
    .slice(0, MAX_SELECTED_SNAPSHOTS)
    .map((project) => {
      const snapshot = snapshots.get(project.latestSnapshotId!)!;
      return {
        workspaceRoot: project.root,
        workspaceName: project.name,
        snapshotId: snapshot.id,
        sourceRevision: snapshot.revision,
        generatedAt: snapshot.generatedAt,
        lastOpenedAt: project.lastOpenedAt,
        nodeCount: snapshot.nodeCount,
        edgeCount: snapshot.edgeCount,
      };
    });
}

export async function federateSnapshots(options: {
  activeGraph: ArchitectureGraph;
  activeWorkspaceName: string;
  snapshotIds: string[];
  state: WorkbenchState;
  approvals?: FederationApproval[];
  loadSnapshot: (
    id: string,
    workspaceRoot: string,
  ) => Promise<ArchitectureGraph>;
}): Promise<ArchitectureFederation> {
  if (!Array.isArray(options.snapshotIds))
    throw new Error("Federation snapshot ids must be an array");
  if (options.snapshotIds.length > MAX_SELECTED_SNAPSHOTS)
    throw new Error(
      `Federation supports at most ${MAX_SELECTED_SNAPSHOTS} snapshot repositories`,
    );
  if (
    options.snapshotIds.some((id) => typeof id !== "string" || !id) ||
    new Set(options.snapshotIds).size !== options.snapshotIds.length
  )
    throw new Error("Federation snapshot ids must be non-empty and unique");

  const candidates = new Map(
    federationCandidates(options.state, options.activeGraph.workspaceRoot).map(
      (candidate) => [candidate.snapshotId, candidate],
    ),
  );
  const selected = options.snapshotIds.map((id) => {
    const candidate = candidates.get(id);
    if (!candidate)
      throw new Error(
        "Federation may only use the latest reading of a recent inactive project",
      );
    return candidate;
  });
  const graphs = await Promise.all(
    selected.map((candidate) =>
      options.loadSnapshot(candidate.snapshotId, candidate.workspaceRoot),
    ),
  );
  const inputs: FederationInput[] = [
    {
      graph: options.activeGraph,
      workspaceName: options.activeWorkspaceName,
      role: "active",
    },
    ...graphs.map((graph, index) => ({
      graph,
      workspaceName: selected[index].workspaceName,
      snapshotId: selected[index].snapshotId,
      role: "snapshot" as const,
    })),
  ];
  return buildArchitectureFederation(inputs, {
    approvals: options.approvals,
  });
}
