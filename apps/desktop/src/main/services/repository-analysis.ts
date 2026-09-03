import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ARCHITECTURE_ANALYZER_VERSION,
  analyzeRepository,
  type ArchitectureCache,
  type ArchitectureCacheEntry,
  type AnalysisOptions,
} from "./architecture";
import type { ArchitectureGraph } from "../../shared/architecture";
import {
  acceptedByUserReceipt,
  evaluateArchitectureCandidate,
} from "../../shared/analysis-integrity";
import { finalizeArchitectureGraph } from "../../shared/architecture-ir";
import type { SemanticGraph } from "../../shared/semantic";
import { contentHash } from "./workspace-files";

type Pending = {
  root: string;
  callCorroborator?: AnalysisOptions["callCorroborator"];
  invalidatedPaths?: ReadonlySet<string>;
  resolve: (graph: ArchitectureGraph) => void;
  reject: (reason: unknown) => void;
};
/** One active scan and one coalesced follow-up batch; no overlapping AST scans on file-watch bursts. */
export class RepositoryAnalysisService {
  private pending: Pending[] = [];
  private running = false;
  private closed = false;
  private controller: AbortController | null = null;
  private currentRoot: string | null = null;
  private cache: ArchitectureCache = new Map();
  private previousSemantic: SemanticGraph | null = null;
  private indexRoot: string | null = null;
  private lastKnownGood: ArchitectureGraph | null = null;
  private pendingCandidate: {
    graph: ArchitectureGraph;
    cache: ArchitectureCache;
  } | null = null;
  constructor(
    private analyzer: (
      root: string,
      options: AnalysisOptions,
    ) => Promise<ArchitectureGraph> = analyzeRepository,
  ) {}
  setIndexRoot(directory: string) {
    if (!path.isAbsolute(directory))
      throw new Error("The architecture index directory must be absolute");
    this.indexRoot = directory;
  }
  private indexPath(root: string) {
    if (!this.indexRoot) return null;
    const id = contentHash(path.resolve(root).toLowerCase()).slice(0, 32);
    return path.join(this.indexRoot, `${id}.json`);
  }
  private lastKnownGoodPath(root: string) {
    if (!this.indexRoot) return null;
    const id = contentHash(path.resolve(root).toLowerCase()).slice(0, 32);
    return path.join(
      path.dirname(this.indexRoot),
      "last-known-good",
      `${id}.json`,
    );
  }
  private sourceGraph(graph: ArchitectureGraph): ArchitectureGraph {
    const { integrity: _integrity, ...source } = graph;
    return structuredClone(source);
  }
  private async loadLastKnownGood(root: string) {
    const target = this.lastKnownGoodPath(root);
    if (!target) return null;
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > 150_000_000)
        throw new Error("Last-known-good graph exceeds its 150 MB safety bound");
      const value = JSON.parse(await fs.readFile(target, "utf8"));
      if (
        !value ||
        value.contract !== "witch.last-known-good/v1" ||
        value.workspaceRoot !== path.resolve(root) ||
        !value.graph ||
        value.graph.workspaceRoot !== path.resolve(root)
      )
        return null;
      const {
        validation: _validation,
        integrity: _integrity,
        ...draft
      } = value.graph as ArchitectureGraph;
      return finalizeArchitectureGraph(draft);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        `Cannot load the persistent last-known-good architecture: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  private async atomicWrite(target: string, value: unknown) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(value) + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }
  private async saveLastKnownGood(root: string, graph: ArchitectureGraph) {
    const target = this.lastKnownGoodPath(root);
    if (!target) return;
    await this.atomicWrite(target, {
      contract: "witch.last-known-good/v1",
      workspaceRoot: path.resolve(root),
      acceptedAt: new Date().toISOString(),
      graph: this.sourceGraph(graph),
    });
  }
  private async confirmedDeletedPaths(
    root: string,
    baseline: ArchitectureGraph,
    candidate: ArchitectureGraph,
  ) {
    const candidatePaths = new Set(
      candidate.nodes
        .filter((node) => node.kind === "file" && node.path)
        .map((node) => node.path!),
    );
    const missing = baseline.nodes
      .filter(
        (node) =>
          node.kind === "file" && node.path && !candidatePaths.has(node.path),
      )
      .map((node) => node.path!);
    const resolvedRoot = path.resolve(root);
    const deleted = new Set<string>();
    for (let offset = 0; offset < missing.length; offset += 64) {
      await Promise.all(
        missing.slice(offset, offset + 64).map(async (relative) => {
          const target = path.resolve(resolvedRoot, relative);
          if (
            target !== resolvedRoot &&
            !target.startsWith(resolvedRoot + path.sep)
          )
            return;
          try {
            await fs.lstat(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              deleted.add(relative);
          }
        }),
      );
    }
    return deleted;
  }
  private async loadIndex(root: string): Promise<ArchitectureCache> {
    const target = this.indexPath(root);
    if (!target) return new Map();
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > 100_000_000)
        throw new Error("Architecture index exceeds its 100 MB safety bound");
      const value = JSON.parse(await fs.readFile(target, "utf8"));
      if (
        !value ||
        value.schemaVersion !== 1 ||
        value.analyzerVersion !== ARCHITECTURE_ANALYZER_VERSION ||
        value.workspaceRoot !== path.resolve(root) ||
        !Array.isArray(value.entries) ||
        value.entries.length > 20_000
      )
        return new Map();
      const cache: ArchitectureCache = new Map();
      for (const pair of value.entries) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          path.isAbsolute(pair[0]) ||
          pair[0].includes("..") ||
          !pair[1] ||
          typeof pair[1].hash !== "string" ||
          !Array.isArray(pair[1].symbols) ||
          !Array.isArray(pair[1].imports)
        )
          continue;
        cache.set(pair[0], {
          ...(pair[1] as ArchitectureCacheEntry),
          persistent: true,
        });
      }
      return cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      return new Map();
    }
  }
  private async saveIndex(root: string) {
    const target = this.indexPath(root);
    if (!target) return;
    const entries = [...this.cache].slice(0, 20_000).map(([file, entry]) => {
      const { content: _content, persistent: _persistent, ...durable } = entry;
      return [file, durable] as const;
    });
    const value = {
      schemaVersion: 1,
      analyzerVersion: ARCHITECTURE_ANALYZER_VERSION,
      workspaceRoot: path.resolve(root),
      savedAt: new Date().toISOString(),
      entries,
    };
    await this.atomicWrite(target, value);
  }
  async clearIndex(root: string) {
    if (this.currentRoot === root) {
      this.cache.clear();
      this.previousSemantic = this.lastKnownGood?.semantic || null;
      this.pendingCandidate = null;
    }
    const target = this.indexPath(root);
    if (target)
      await fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
  async acceptPendingCandidate(root: string, revision: string) {
    if (
      this.currentRoot !== root ||
      !this.pendingCandidate ||
      this.pendingCandidate.graph.workspaceRoot !== path.resolve(root) ||
      this.pendingCandidate.graph.revision !== revision
    )
      throw new Error(
        "The quarantined architecture candidate is no longer available; analyze again.",
      );
    const candidate = this.sourceGraph(this.pendingCandidate.graph);
    const baseline = this.lastKnownGood;
    const receipt = acceptedByUserReceipt(
      evaluateArchitectureCandidate(baseline, candidate),
    );
    this.cache = this.pendingCandidate.cache;
    this.pendingCandidate = null;
    this.lastKnownGood = candidate;
    this.previousSemantic = candidate.semantic || null;
    await Promise.all([
      this.saveIndex(root),
      this.saveLastKnownGood(root, candidate),
    ]);
    return { ...candidate, integrity: receipt };
  }
  analyze(
    root: string,
    options: Pick<
      AnalysisOptions,
      "callCorroborator" | "invalidatedPaths"
    > = {},
  ) {
    if (this.closed)
      return Promise.reject(new Error("Repository analyzer is closed"));
    return new Promise<ArchitectureGraph>((resolve, reject) => {
      this.pending.push({
        root,
        callCorroborator: options.callCorroborator,
        invalidatedPaths: options.invalidatedPaths,
        resolve,
        reject,
      });
      if (this.running && root !== this.currentRoot)
        this.controller?.abort(
          new Error("Analysis superseded by a different project"),
        );
      void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length && !this.closed) {
        const all = this.pending.splice(0),
          root = all.at(-1)!.root;
        const batch = all.filter((request) => request.root === root);
        for (const request of all)
          if (request.root !== root)
            request.reject(
              new Error("Analysis superseded by a different project"),
            );
        if (this.currentRoot !== root) {
          try {
            this.cache.clear();
            this.previousSemantic = null;
            this.lastKnownGood = null;
            this.pendingCandidate = null;
            this.cache = this.indexRoot
              ? await this.loadIndex(root)
              : new Map();
            this.lastKnownGood = this.indexRoot
              ? await this.loadLastKnownGood(root)
              : null;
            this.previousSemantic = this.lastKnownGood?.semantic || null;
          } catch (error) {
            for (const request of batch) request.reject(error);
            continue;
          }
        }
        this.currentRoot = root;
        this.controller = new AbortController();
        try {
          const baselineCache = new Map(this.cache);
          const graph = await this.analyzer(root, {
            cache: this.cache,
            signal: this.controller.signal,
            previousSemantic: this.previousSemantic,
            callCorroborator: all.at(-1)!.callCorroborator,
            invalidatedPaths: new Set(
              batch.flatMap((request) => [...(request.invalidatedPaths || [])]),
            ),
          });
          this.controller.signal.throwIfAborted();
          const sourceGraph = this.sourceGraph(graph);
          let receipt = evaluateArchitectureCandidate(
            this.lastKnownGood,
            sourceGraph,
          );
          if (receipt.status === "fallback" && this.lastKnownGood) {
            receipt = evaluateArchitectureCandidate(
              this.lastKnownGood,
              sourceGraph,
              await this.confirmedDeletedPaths(
                root,
                this.lastKnownGood,
                sourceGraph,
              ),
            );
          }
          if (receipt.status === "fallback" && this.lastKnownGood) {
            const candidateCache = new Map(this.cache);
            this.cache = baselineCache;
            this.pendingCandidate = { graph: sourceGraph, cache: candidateCache };
            const fallback = {
              ...this.sourceGraph(this.lastKnownGood),
              integrity: receipt,
            };
            for (const request of batch) request.resolve(fallback);
            continue;
          }
          this.pendingCandidate = null;
          this.lastKnownGood = sourceGraph;
          this.previousSemantic = sourceGraph.semantic || null;
          await Promise.all([
            this.saveIndex(root),
            this.saveLastKnownGood(root, sourceGraph),
          ]);
          const accepted = { ...sourceGraph, integrity: receipt };
          for (const request of batch) request.resolve(accepted);
        } catch (error) {
          for (const request of batch) request.reject(error);
        }
      }
    } finally {
      this.running = false;
      this.controller = null;
    }
  }
  dispose() {
    this.closed = true;
    this.controller?.abort(new Error("Repository analyzer closed"));
    for (const request of this.pending.splice(0))
      request.reject(new Error("Repository analyzer closed"));
    this.cache.clear();
    this.previousSemantic = null;
    this.lastKnownGood = null;
    this.pendingCandidate = null;
  }
}
