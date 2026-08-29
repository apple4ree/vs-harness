import type { ComponentContext } from "./architecture";
export type AgentMode = "ask" | "change";
export type AgentRunStatus =
  | "preparing"
  | "running"
  | "review"
  | "completed"
  | "interrupted"
  | "failed"
  | "applied"
  | "archived";
export type ProposedChange = {
  path: string;
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
};
export type AgentRun = {
  id: string;
  workspaceRoot: string;
  workspaceName: string;
  prompt: string;
  mode: AgentMode;
  contexts: ComponentContext[];
  status: AgentRunStatus;
  createdAt: string;
  completedAt?: string;
  response: string;
  error?: string;
  activity: string[];
  changes: ProposedChange[];
  isolation: "read-only" | "workspace-copy";
  stagingRoot?: string;
  appliedPaths?: string[];
  archivePath?: string;
  archivedAt?: string;
};
export type AgentEvent = { run: AgentRun };
export type AgentRequest = {
  prompt: string;
  mode: AgentMode;
  contexts: ComponentContext[];
};
