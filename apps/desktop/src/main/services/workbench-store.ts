import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ArchitectureGraph } from "../../shared/architecture";
import type { SnapshotMetadata, WorkbenchState } from "../../shared/history";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const emptyState = (): WorkbenchState => ({
  version: 2,
  projects: [],
  snapshots: [],
  tasks: [],
});
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** A compact index and immutable, separately stored graph readings. */
export class WorkbenchStore {
  private state: WorkbenchState | null = null;
  private loading: Promise<WorkbenchState> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private damagedPrimary = false;
  constructor(
    private directory: string,
    private warn: (message: string) => void = () => {},
  ) {}
  private get target() {
    return path.join(this.directory, "witch-state.json");
  }
  async flush() {
    await this.loading;
    await this.writes;
  }

  private async atomicWrite(target: string, value: unknown) {
    const contents = JSON.stringify(value) + "\n";
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  private async read(target: string): Promise<any> {
    if ((await fs.stat(target)).size > 150_000_000)
      throw new Error("Workbench history exceeds 150 MB");
    const value = JSON.parse(await fs.readFile(target, "utf8"));
    if (
      !value ||
      ![1, 2].includes(value.version) ||
      !Array.isArray(value.projects) ||
      !Array.isArray(value.snapshots) ||
      !Array.isArray(value.tasks) ||
      value.projects.length > 1000 ||
      value.snapshots.length > 2000 ||
      value.tasks.length > 1000 ||
      value.projects.some(
        (item: any) =>
          !item ||
          typeof item.root !== "string" ||
          !path.isAbsolute(item.root) ||
          typeof item.name !== "string" ||
          typeof item.lastOpenedAt !== "string",
      ) ||
      value.snapshots.some(
        (item: any) =>
          !item ||
          !UUID.test(item.id) ||
          typeof item.workspaceRoot !== "string" ||
          !path.isAbsolute(item.workspaceRoot),
      ) ||
      value.tasks.some(
        (item: any) =>
          !item ||
          !UUID.test(item.id) ||
          typeof item.workspaceRoot !== "string" ||
          !path.isAbsolute(item.workspaceRoot),
      )
    )
      throw new Error("Invalid workbench history format");
    if (
      value.version === 2 &&
      value.snapshots.some(
        (item: any) =>
          !Number.isSafeInteger(item.nodeCount) ||
          !Number.isSafeInteger(item.edgeCount) ||
          item.nodeCount < 0 ||
          item.edgeCount < 0 ||
          "nodes" in item ||
          "edges" in item,
      )
    )
      throw new Error("Invalid graph-reading index");
    return value;
  }

  private metadata(snapshot: any): SnapshotMetadata {
    return {
      schemaVersion: 1,
      id: snapshot.id,
      workspaceRoot: snapshot.workspaceRoot,
      workspaceName:
        snapshot.workspaceName || path.basename(snapshot.workspaceRoot),
      commit: snapshot.commit || "uncommitted",
      createdAt:
        snapshot.createdAt || snapshot.generatedAt || new Date().toISOString(),
      generatedAt:
        snapshot.generatedAt || snapshot.createdAt || new Date().toISOString(),
      analyzerVersion: snapshot.analyzerVersion || "legacy",
      revision: snapshot.revision || "legacy",
      scannedFiles: snapshot.scannedFiles || 0,
      totalFiles: snapshot.totalFiles || snapshot.scannedFiles || 0,
      truncated: Boolean(snapshot.truncated),
      warnings: Array.isArray(snapshot.warnings)
        ? snapshot.warnings.slice(0, 100)
        : [],
      nodeCount: Array.isArray(snapshot.nodes)
        ? snapshot.nodes.length
        : snapshot.nodeCount || 0,
      edgeCount: Array.isArray(snapshot.edges)
        ? snapshot.edges.length
        : snapshot.edgeCount || 0,
    };
  }

  private async writeIndex(value: WorkbenchState) {
    if (this.damagedPrimary) {
      const archive = `${this.target}.corrupt-${randomUUID()}`;
      await fs.copyFile(this.target, archive).catch((error) => {
        if (!missing(error)) throw error;
      });
    } else {
      await fs
        .copyFile(this.target, this.target + ".previous")
        .catch((error) => {
          if (!missing(error)) throw error;
        });
    }
    await this.atomicWrite(this.target, value);
    this.damagedPrimary = false;
  }

  private async load(): Promise<WorkbenchState> {
    if (this.state) return this.state;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let raw: any;
      let loadedPath = this.target;
      try {
        raw = await this.read(this.target);
      } catch (primaryError) {
        try {
          raw = await this.read(this.target + ".previous");
          loadedPath += ".previous";
        } catch (backupError) {
          if (missing(primaryError) && missing(backupError))
            return (this.state = emptyState());
          throw new Error(
            `Workbench history could not be loaded; original files are retained at ${this.target}. ${primaryError}`,
          );
        }
        this.damagedPrimary = true;
        this.warn(
          "Project history was recovered from its previous complete save. The damaged index will be retained separately.",
        );
      }
      if (raw.version === 1) {
        // Keep the exact old index before moving large graph bodies out of it.
        await fs.copyFile(
          loadedPath,
          path.join(this.directory, `witch-state.v1-${randomUUID()}.json`),
        );
        for (const snapshot of raw.snapshots)
          await this.atomicWrite(
            path.join(this.directory, "snapshots", snapshot.id + ".json"),
            snapshot,
          );
        raw = {
          ...raw,
          version: 2,
          snapshots: raw.snapshots.map((snapshot: any) =>
            this.metadata(snapshot),
          ),
        };
        await this.writeIndex(raw);
      }
      this.state = raw;
      return raw as WorkbenchState;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async get(): Promise<WorkbenchState> {
    await this.writes.catch(() => undefined);
    return structuredClone(await this.load());
  }

  async update<T>(mutate: (state: WorkbenchState) => T): Promise<T> {
    const operation = this.writes
      .catch(() => undefined)
      .then(async () => {
        const next = structuredClone(await this.load());
        const result = mutate(next);
        await this.writeIndex(next);
        this.state = next;
        return result;
      });
    this.writes = operation;
    return operation;
  }

  async saveSnapshot(
    graph: ArchitectureGraph,
    workspaceName: string,
    commit: string,
  ) {
    const snapshot = {
      ...graph,
      id: randomUUID(),
      workspaceName,
      commit,
      createdAt: new Date().toISOString(),
    };
    await this.atomicWrite(
      path.join(this.directory, "snapshots", snapshot.id + ".json"),
      snapshot,
    );
    const metadata = this.metadata(snapshot);
    await this.update((state) => {
      state.snapshots.unshift(metadata);
      // Only the index is bounded. Full readings remain on disk until explicit cleanup.
      const counts = new Map<string, number>();
      state.snapshots = state.snapshots
        .filter((item) => {
          const count = (counts.get(item.workspaceRoot) || 0) + 1;
          counts.set(item.workspaceRoot, count);
          return count <= 25;
        })
        .slice(0, 750);
      const project = state.projects.find(
        (item) => item.root === graph.workspaceRoot,
      );
      if (project) {
        project.latestSnapshotId = metadata.id;
        project.lastCommit = commit;
      }
    });
    return metadata;
  }
}
