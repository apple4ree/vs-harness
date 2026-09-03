import type { VisualQualityDiagnostic, VisualQualityReceipt } from "./architecture-visual-quality";

export type RenderedGraphReceipt = {
  contract: "witch.rendered-graph/v1";
  valid: boolean;
  viewConfigHash: string;
  measuredAt: string;
  viewport: {
    width: number;
    height: number;
    zoom: number;
  };
  quality: VisualQualityReceipt;
};

export type GraphDeliveryReceipt = {
  contract: "witch.graph-delivery/v1";
  generatedAt: string;
  sourceRevision: string;
  semanticRevision: string | null;
  viewConfigHash: string;
  state: "candidate" | "accepted" | "preserved-last-good" | "rejected";
  valid: boolean;
  stages: {
    analysis: "pass" | "fail";
    projection: "pass" | "warning" | "fail";
    rendered: "pending" | "pass" | "warning" | "fail";
  };
  diagnostics: VisualQualityDiagnostic[];
};

export function stableViewConfigHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `view-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createGraphDeliveryReceipt(input: {
  sourceRevision: string;
  semanticRevision?: string | null;
  sourceValid: boolean;
  viewConfigHash: string;
  projection: VisualQualityReceipt;
  rendered?: RenderedGraphReceipt | null;
  state?: GraphDeliveryReceipt["state"];
}): GraphDeliveryReceipt {
  const renderedStage = input.rendered
    ? input.rendered.quality.status
    : "pending";
  const valid =
    input.sourceValid &&
    input.projection.status !== "fail" &&
    Boolean(input.rendered?.valid);
  return {
    contract: "witch.graph-delivery/v1",
    generatedAt: input.rendered?.measuredAt || new Date().toISOString(),
    sourceRevision: input.sourceRevision,
    semanticRevision: input.semanticRevision || null,
    viewConfigHash: input.viewConfigHash,
    state: input.state || (valid ? "accepted" : input.rendered ? "rejected" : "candidate"),
    valid,
    stages: {
      analysis: input.sourceValid ? "pass" : "fail",
      projection: input.projection.status,
      rendered: renderedStage,
    },
    diagnostics: [
      ...input.projection.diagnostics,
      ...(input.rendered?.quality.diagnostics || []),
    ],
  };
}

export type LastGoodResolution<T> = {
  value: T;
  state: "accepted" | "candidate-invalid" | "preserved-last-good";
};

/** Keeps the latest fully validated view per stable view family. */
export class LastGoodGraphStore<T> {
  private readonly values = new Map<string, T>();

  resolve(key: string, candidate: T, valid: boolean): LastGoodResolution<T> {
    if (valid) {
      this.values.set(key, candidate);
      return { value: candidate, state: "accepted" };
    }
    const previous = this.values.get(key);
    return previous
      ? { value: previous, state: "preserved-last-good" }
      : { value: candidate, state: "candidate-invalid" };
  }

  clear() {
    this.values.clear();
  }
}
