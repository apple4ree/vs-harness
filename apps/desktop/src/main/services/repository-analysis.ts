import {
  analyzeRepository,
  type ArchitectureCache,
  type AnalysisOptions,
} from "./architecture";
import type { ArchitectureGraph } from "../../shared/architecture";
import type { SemanticGraph } from "../../shared/semantic";

type Pending = {
  root: string;
  callCorroborator?: AnalysisOptions["callCorroborator"];
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
  constructor(
    private analyzer: (
      root: string,
      options: AnalysisOptions,
    ) => Promise<ArchitectureGraph> = analyzeRepository,
  ) {}
  analyze(
    root: string,
    options: Pick<AnalysisOptions, "callCorroborator"> = {},
  ) {
    if (this.closed)
      return Promise.reject(new Error("Repository analyzer is closed"));
    return new Promise<ArchitectureGraph>((resolve, reject) => {
      this.pending.push({
        root,
        callCorroborator: options.callCorroborator,
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
          this.cache.clear();
          this.previousSemantic = null;
        }
        this.currentRoot = root;
        this.controller = new AbortController();
        try {
          const graph = await this.analyzer(root, {
            cache: this.cache,
            signal: this.controller.signal,
            previousSemantic: this.previousSemantic,
            callCorroborator: all.at(-1)!.callCorroborator,
          });
          this.controller.signal.throwIfAborted();
          this.previousSemantic = graph.semantic || null;
          for (const request of batch) request.resolve(graph);
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
  }
}
