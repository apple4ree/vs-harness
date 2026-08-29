import type { ArchitectureGraph } from "./architecture";

export type SnapshotMetadata = Omit<ArchitectureGraph, "nodes" | "edges"> & {
  id: string;
  workspaceName: string;
  commit: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
};

export type ProjectRecord = {
  root: string;
  name: string;
  lastOpenedAt: string;
  lastBranch: string;
  lastCommit: string;
  latestSnapshotId?: string;
};

export type TaskRecord = {
  id: string;
  provider: "codex";
  workspaceRoot: string;
  focusFile?: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "interrupted" | "failed";
  summary?: string;
};

export type WorkbenchState = {
  version: 2;
  projects: ProjectRecord[];
  snapshots: SnapshotMetadata[];
  tasks: TaskRecord[];
};
