export type SessionDocument = {
  path: string;
  draft?: { content: string; savedContent: string; hash: string };
};
export type WorkspaceSession = {
  version: 1;
  root: string;
  documents: SessionDocument[];
  activePath: string | null;
  view: "architecture" | "source";
  updatedAt: string;
};
export type SessionSnapshot = {
  session: WorkspaceSession | null;
  warning?: string;
};
export type SessionUpdate = Omit<WorkspaceSession, "version" | "updatedAt">;
