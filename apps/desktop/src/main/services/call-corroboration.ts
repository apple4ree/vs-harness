import type {
  ArchitectureNode,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type { OutgoingCall } from "../../shared/language";
import { readWorkspaceText } from "./workspace-files";
import type { LanguageIntelligence } from "./language-intelligence";
import type {
  ResolvedSymbolCall,
  SymbolCallCorroboration,
} from "./semantic-analysis";

export type CallCorroborationInput = {
  root: string;
  nodes: ArchitectureNode[];
  calls: ResolvedSymbolCall[];
  signal?: AbortSignal;
};

export type CallCorroborationResult = {
  observations: SymbolCallCorroboration[];
  warnings: string[];
};

export type CallCorroborator = (
  input: CallCorroborationInput,
) => Promise<CallCorroborationResult>;

type SourceSymbol = {
  source: ArchitectureNode;
  symbol: CodeSymbol;
};

function providerName(resolver: ResolvedSymbolCall["resolver"]) {
  return resolver === "python-static" ? "pyright" : "rust-analyzer";
}

function targetSymbol(
  call: OutgoingCall,
  symbolsByPath: Map<string, SourceSymbol[]>,
): SourceSymbol | null {
  const line = call.selectionRange.start.line + 1;
  const candidates = (symbolsByPath.get(call.path) || [])
    .filter(({ symbol }) => symbol.line <= line && symbol.endLine >= line)
    .sort((left, right) => {
      const leftName =
        left.symbol.name === call.name ||
        left.symbol.qualifiedName?.split(/[.:]/).at(-1) === call.name;
      const rightName =
        right.symbol.name === call.name ||
        right.symbol.qualifiedName?.split(/[.:]/).at(-1) === call.name;
      return (
        Number(rightName) - Number(leftName) ||
        left.symbol.endLine -
          left.symbol.line -
          (right.symbol.endLine - right.symbol.line)
      );
    });
  return candidates[0] || null;
}

function evidenceAt(
  source: ArchitectureNode,
  content: string,
  line: number,
): SourceEvidence {
  return {
    path: source.path!,
    line,
    hash: source.hash,
    excerpt: content.split(/\r?\n/)[line - 1]?.trim().slice(0, 300),
  };
}

async function bounded<T>(promise: Promise<T>, milliseconds: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Uses language-server call hierarchy only as a second static observer. Absence
 * is never treated as a contradiction, and a conflict is emitted only when one
 * source line has exactly one inferred target and one different internal LSP
 * target. Project code is synchronized as text but never imported or executed.
 */
export async function corroborateSymbolCalls(
  input: CallCorroborationInput,
  language: LanguageIntelligence,
): Promise<CallCorroborationResult> {
  const warnings: string[] = [];
  const observations: SymbolCallCorroboration[] = [];
  const candidates = input.calls.filter(
    (call) =>
      call.trust === "inferred" &&
      (call.resolver === "python-static" || call.resolver === "rust-static"),
  );
  if (!candidates.length) return { observations, warnings };

  const providerStatus = new Map(
    (await language.status()).providers?.map((provider) => [
      provider.id,
      provider,
    ]) || [],
  );
  const sourceSymbols = new Map<string, SourceSymbol>();
  const symbolsByPath = new Map<string, SourceSymbol[]>();
  for (const source of input.nodes) {
    if (!source.path) continue;
    for (const symbol of source.symbols) {
      const entry = { source, symbol };
      sourceSymbols.set(symbol.id, entry);
      symbolsByPath.set(source.path, [
        ...(symbolsByPath.get(source.path) || []),
        entry,
      ]);
    }
  }
  const grouped = new Map<string, ResolvedSymbolCall[]>();
  for (const call of candidates) {
    const id = `${call.resolver}:${call.fromSourceSymbolId}`;
    grouped.set(id, [...(grouped.get(id) || []), call]);
  }
  const groups = [...grouped.values()].slice(0, 48);
  if (grouped.size > groups.length)
    warnings.push(
      `Language-server call corroboration sampled ${groups.length}/${grouped.size} inferred callers to preserve analysis responsiveness.`,
    );
  const unavailable = new Set<string>();
  const contentCache = new Map<string, string>();
  const startedAt = Date.now();

  const inspect = async (calls: ResolvedSymbolCall[]) => {
    input.signal?.throwIfAborted();
    const first = calls[0];
    const caller = sourceSymbols.get(first.fromSourceSymbolId);
    if (!caller?.source.path) return;
    const languageId = first.resolver === "python-static" ? "python" : "rust";
    const status = providerStatus.get(languageId);
    if (!status?.installed) {
      if (!unavailable.has(languageId)) {
        unavailable.add(languageId);
        warnings.push(
          `${providerName(first.resolver)} call hierarchy was unavailable; ${languageId} calls remain source-inferred.`,
        );
      }
      return;
    }
    let content = contentCache.get(caller.source.path);
    if (content === undefined) {
      content = await readWorkspaceText(input.root, caller.source.path);
      contentCache.set(caller.source.path, content);
    }
    const line = content.split(/\r?\n/)[caller.symbol.line - 1] || "";
    const character = Math.max(0, line.indexOf(caller.symbol.name));
    let hierarchy: Awaited<ReturnType<LanguageIntelligence["outgoingCalls"]>>;
    try {
      hierarchy = await bounded(
        language.outgoingCalls(caller.source.path, {
          line: caller.symbol.line - 1,
          character,
        }),
        3_500,
      );
    } catch (error) {
      warnings.push(
        `${providerName(first.resolver)} could not corroborate ${caller.symbol.qualifiedName || caller.symbol.name}: ${error instanceof Error ? error.message : error}`,
      );
      return;
    }
    if (!hierarchy) return;

    const observed = hierarchy.outgoing.flatMap((outgoing) => {
      const target = targetSymbol(outgoing, symbolsByPath);
      return target ? [{ outgoing, target }] : [];
    });
    const observedTargets = new Set(
      observed.map(({ target }) => target.symbol.id),
    );
    for (const call of calls)
      if (observedTargets.has(call.toSourceSymbolId))
        observations.push({
          fromSourceSymbolId: call.fromSourceSymbolId,
          inferredToSourceSymbolId: call.toSourceSymbolId,
          observedToSourceSymbolId: call.toSourceSymbolId,
          status: "corroborated",
          provider: providerName(call.resolver),
          evidence: call.evidence.slice(0, 4),
        });

    const staticByLine = new Map<number, Set<string>>();
    for (const call of calls)
      for (const site of call.evidence) {
        const targets = staticByLine.get(site.line) || new Set<string>();
        targets.add(call.toSourceSymbolId);
        staticByLine.set(site.line, targets);
      }
    const observedByLine = new Map<
      number,
      Array<{ target: SourceSymbol; outgoing: OutgoingCall }>
    >();
    for (const item of observed)
      for (const range of item.outgoing.fromRanges) {
        const sourceLine = range.start.line + 1;
        observedByLine.set(sourceLine, [
          ...(observedByLine.get(sourceLine) || []),
          item,
        ]);
      }
    for (const [sourceLine, staticTargets] of staticByLine) {
      const lspTargets = observedByLine.get(sourceLine) || [];
      const distinctObserved = new Map(
        lspTargets.map((item) => [item.target.symbol.id, item]),
      );
      if (staticTargets.size !== 1 || distinctObserved.size !== 1) continue;
      const inferredTarget = [...staticTargets][0];
      const [observedTarget, observedItem] = [...distinctObserved.entries()][0];
      if (inferredTarget === observedTarget) continue;
      observations.push({
        fromSourceSymbolId: first.fromSourceSymbolId,
        inferredToSourceSymbolId: inferredTarget,
        observedToSourceSymbolId: observedTarget,
        status: "conflicting",
        provider: providerName(first.resolver),
        evidence: [
          evidenceAt(caller.source, content, sourceLine),
          {
            path: observedItem.target.source.path!,
            line: observedItem.target.symbol.line,
            endLine: observedItem.target.symbol.endLine,
            hash: observedItem.target.source.hash,
            excerpt: observedItem.target.symbol.signature,
          },
        ],
      });
    }
  };

  for (let index = 0; index < groups.length; index += 4) {
    if (Date.now() - startedAt > 12_000) {
      warnings.push(
        `Language-server call corroboration stopped after its 12 second safety budget (${index}/${groups.length} callers checked).`,
      );
      break;
    }
    await Promise.all(groups.slice(index, index + 4).map(inspect));
  }
  return {
    observations: [
      ...new Map(
        observations.map((item) => [
          `${item.fromSourceSymbolId}:${item.inferredToSourceSymbolId}:${item.observedToSourceSymbolId}:${item.status}`,
          item,
        ]),
      ).values(),
    ],
    warnings: warnings.slice(0, 20),
  };
}
