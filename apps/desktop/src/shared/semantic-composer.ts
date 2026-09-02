export const SEMANTIC_COMPOSER_PROVIDERS = [
  "rules",
  "codex",
  "claude",
  "openai",
  "anthropic",
] as const;

export type SemanticComposerProviderId =
  (typeof SEMANTIC_COMPOSER_PROVIDERS)[number];

export type SemanticComposerRequest = {
  provider: SemanticComposerProviderId;
  model?: string;
  focus?: "architecture" | "workflow";
  maxComponents?: number;
  fallbackToRules?: boolean;
};

export type SemanticComposerDraft = {
  title: string;
  summary: string;
  components: Array<{
    id: string;
    label: string;
    kind: "component" | "external-system";
    responsibility: string;
    candidateIds: string[];
    confidence: number;
  }>;
  relations: Array<{
    from: string;
    to: string;
    kind:
      | "calls"
      | "reads"
      | "writes"
      | "emits"
      | "subscribes"
      | "routes-to"
      | "executes"
      | "depends-on";
    label: string;
    candidateRelationIds: string[];
    confidence: number;
  }>;
  workflows: Array<{
    id: string;
    label: string;
    description: string;
    componentIds: string[];
    sourceWorkflowIds: string[];
    confidence: number;
  }>;
  questions: Array<{
    subjectId: string;
    prompt: string;
    recommendation: string;
    options: string[];
  }>;
};

export type SemanticCompositionDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type SemanticCompositionReceipt = {
  contract: "witch.composition/v1";
  valid: boolean;
  provider: SemanticComposerProviderId;
  model: string;
  sourceRevision: string;
  revision: string;
  generatedAt: string;
  inputHash: string;
  promptHash: string;
  autoApproved: true;
  fallback: boolean;
  componentCount: number;
  relationCount: number;
  workflowCount: number;
  questionCount: number;
  rejectedCount: number;
  diagnostics: SemanticCompositionDiagnostic[];
};

export type SemanticComposerResult = {
  graph: import("./architecture").ArchitectureGraph;
  receipt: SemanticCompositionReceipt;
};

export function validateSemanticComposerRequest(
  value: unknown,
): SemanticComposerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Semantic Composer request must be an object");
  const request = value as SemanticComposerRequest;
  if (!SEMANTIC_COMPOSER_PROVIDERS.includes(request.provider))
    throw new Error("Unsupported Semantic Composer provider");
  if (
    request.model !== undefined &&
    (typeof request.model !== "string" ||
      !/^[a-zA-Z0-9._:/-]{1,120}$/.test(request.model))
  )
    throw new Error("Model must be a provider model identifier");
  if (
    request.focus !== undefined &&
    !["architecture", "workflow"].includes(request.focus)
  )
    throw new Error("Unknown Semantic Composer focus");
  const maxComponents = request.maxComponents ?? 12;
  if (
    !Number.isInteger(maxComponents) ||
    maxComponents < 4 ||
    maxComponents > 20
  )
    throw new Error("Semantic Composer supports 4–20 components");
  return {
    provider: request.provider,
    ...(request.model ? { model: request.model } : {}),
    focus: request.focus || "architecture",
    maxComponents,
    fallbackToRules: request.fallbackToRules !== false,
  };
}
