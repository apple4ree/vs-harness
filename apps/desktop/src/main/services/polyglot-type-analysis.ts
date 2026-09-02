import type {
  ArchitectureNode,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type { ResolvedSymbolRelation } from "./semantic-analysis";

type ResolveImport = (file: string, specifier: string) => string | null;

const relationKey = (relation: ResolvedSymbolRelation) =>
  `${relation.kind}:${relation.fromSourceSymbolId}->${relation.toSourceSymbolId}`;

function addRelation(
  relations: Map<string, ResolvedSymbolRelation>,
  relation: ResolvedSymbolRelation,
) {
  if (
    relation.fromSourceSymbolId === relation.toSourceSymbolId ||
    relations.size >= 12_000
  )
    return;
  const key = relationKey(relation);
  const existing = relations.get(key);
  if (!existing) {
    relations.set(key, relation);
    return;
  }
  for (const item of relation.evidence)
    if (
      existing.evidence.length < 20 &&
      !existing.evidence.some(
        (candidate) =>
          candidate.path === item.path && candidate.line === item.line,
      )
    )
      existing.evidence.push(item);
}

function evidence(
  node: ArchitectureNode,
  lines: string[],
  symbol: CodeSymbol,
): SourceEvidence {
  return {
    path: node.id,
    line: symbol.line,
    endLine: symbol.kind === "method" ? symbol.line : undefined,
    hash: node.hash,
    excerpt: lines[symbol.line - 1]?.trim().slice(0, 300),
  };
}

function uniqueSymbol(
  node: ArchitectureNode | undefined,
  name: string,
  kind: CodeSymbol["kind"],
) {
  if (!node) return null;
  const matches = node.symbols.filter(
    (symbol) => symbol.kind === kind && symbol.name === name,
  );
  return matches.length === 1 ? matches[0] : null;
}

function splitTopLevel(value: string) {
  const output: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "(") round++;
    else if (character === ")") round--;
    else if (character === "[") square++;
    else if (character === "]") square--;
    else if (character === "{") curly++;
    else if (character === "}") curly--;
    else if (character === "," && !round && !square && !curly) {
      output.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(value.slice(start).trim());
  return output.filter(Boolean);
}

export async function pythonResolvedTypeRelations(
  sourceNodes: ArchitectureNode[],
  sourceTexts: Map<string, string>,
  resolveImport: ResolveImport,
  signal?: AbortSignal,
) {
  const nodes = new Map(sourceNodes.map((node) => [node.id, node]));
  const relations = new Map<string, ResolvedSymbolRelation>();
  for (const [fileIndex, [file, content]] of [...sourceTexts].entries()) {
    signal?.throwIfAborted();
    if (fileIndex && fileIndex % 24 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const node = nodes.get(file);
    if (!node) continue;
    const lines = content.split(/\r?\n/);
    const importedClasses = new Map<string, CodeSymbol>();
    const moduleAliases = new Map<string, ArchitectureNode>();
    for (const line of lines) {
      const from = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
      if (from) {
        const target = nodes.get(resolveImport(file, from[1]) || "");
        if (!target) continue;
        for (const entry of from[2].replace(/[()]/g, "").split(",")) {
          const match = entry.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (!match) continue;
          const symbol = uniqueSymbol(target, match[1], "class");
          if (symbol) importedClasses.set(match[2] || match[1], symbol);
        }
        continue;
      }
      const imported = line.match(/^\s*import\s+(.+)$/);
      if (!imported) continue;
      for (const entry of imported[1].split(",")) {
        const match = entry.trim().match(/^([.\w]+)(?:\s+as\s+(\w+))?$/);
        if (!match) continue;
        const target = nodes.get(resolveImport(file, match[1]) || "");
        if (target && (match[2] || !match[1].includes(".")))
          moduleAliases.set(match[2] || match[1].split(".")[0], target);
      }
    }
    const resolvedBases = new Map<string, CodeSymbol[]>();
    for (const symbol of node.symbols.filter((item) => item.kind === "class")) {
      const signature = symbol.signature || lines[symbol.line - 1] || "";
      const header = signature.match(
        /\bclass\s+[A-Za-z_]\w*(?:\[[^\]]+\])?\s*\((.*)\)\s*:/,
      );
      if (!header) continue;
      const bases: CodeSymbol[] = [];
      for (const raw of splitTopLevel(header[1])) {
        if (/^(metaclass|slots)\s*=/.test(raw)) continue;
        const normalized = raw
          .replace(/\[[\s\S]*\]$/, "")
          .replace(/\(.*\)$/, "")
          .trim();
        if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(normalized)) continue;
        const parts = normalized.split(".");
        let target: CodeSymbol | null = null;
        if (parts.length === 1)
          target =
            importedClasses.get(parts[0]) ||
            uniqueSymbol(node, parts[0], "class");
        else
          target = uniqueSymbol(moduleAliases.get(parts[0]), parts[1], "class");
        if (!target || target.id === symbol.id) continue;
        bases.push(target);
        addRelation(relations, {
          fromSourceSymbolId: symbol.id,
          toSourceSymbolId: target.id,
          kind: "extends",
          evidence: [evidence(node, lines, symbol)],
          trust: "inferred",
          confidence: 0.9,
          resolver: "python-static",
        });
      }
      if (bases.length) resolvedBases.set(symbol.id, bases);
    }
    const nodeForSymbol = (id: string) =>
      sourceNodes.find((candidate) =>
        candidate.symbols.some((symbol) => symbol.id === id),
      );
    for (const child of node.symbols.filter((item) => item.kind === "class"))
      for (const base of resolvedBases.get(child.id) || []) {
        const baseNode = nodeForSymbol(base.id);
        for (const method of node.symbols.filter(
          (item) => item.kind === "method" && item.containerId === child.id,
        )) {
          const targets = (baseNode?.symbols || []).filter(
            (item) =>
              item.kind === "method" &&
              item.containerId === base.id &&
              item.name === method.name,
          );
          if (targets.length !== 1) continue;
          addRelation(relations, {
            fromSourceSymbolId: method.id,
            toSourceSymbolId: targets[0].id,
            kind: "overrides",
            evidence: [evidence(node, lines, method)],
            trust: "inferred",
            confidence: 0.84,
            resolver: "python-static",
          });
        }
      }
  }
  return [...relations.values()].sort((a, b) =>
    relationKey(a).localeCompare(relationKey(b)),
  );
}

const rustTypeName = (value: string) => {
  const normalized = value
    .trim()
    .replace(/^dyn\s+/, "")
    .replace(/^!/, "")
    .replace(/<.*>$/, "")
    .trim();
  const parts = normalized.split("::").filter(Boolean);
  return parts.at(-1) || "";
};

export async function rustResolvedTypeRelations(
  sourceNodes: ArchitectureNode[],
  sourceTexts: Map<string, string>,
  resolveImport: ResolveImport,
  signal?: AbortSignal,
) {
  const nodes = new Map(sourceNodes.map((node) => [node.id, node]));
  const relations = new Map<string, ResolvedSymbolRelation>();
  for (const [fileIndex, [file, content]] of [...sourceTexts].entries()) {
    signal?.throwIfAborted();
    if (fileIndex && fileIndex % 24 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const node = nodes.get(file);
    if (!node) continue;
    const lines = content.split(/\r?\n/);
    const importedTraits = new Map<string, CodeSymbol>();
    for (const line of lines) {
      const imported = line.trim().match(/^(?:pub\s+)?use\s+(.+);/);
      if (!imported) continue;
      const body = imported[1].trim();
      const entries: Array<{
        specifier: string;
        name: string;
        alias?: string;
      }> = [];
      const braces = body.match(/^(.*)::\{(.+)\}$/);
      if (braces)
        for (const item of braces[2].split(",")) {
          const match = item.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (match)
            entries.push({
              specifier: `${braces[1]}::${match[1]}`,
              name: match[1],
              alias: match[2],
            });
        }
      else {
        const match = body.match(/^(.+?)(?:\s+as\s+(\w+))?$/);
        if (match)
          entries.push({
            specifier: match[1],
            name: rustTypeName(match[1]),
            alias: match[2],
          });
      }
      for (const entry of entries) {
        const target = nodes.get(resolveImport(file, entry.specifier) || "");
        const trait = uniqueSymbol(target, entry.name, "trait");
        if (trait) importedTraits.set(entry.alias || entry.name, trait);
      }
    }
    for (const implementation of node.symbols.filter(
      (symbol) => symbol.kind === "implementation",
    )) {
      const body = implementation.name.replace(/^impl\s+/, "");
      const traitPart = body.match(/^(.+?)\s+for\s+.+$/)?.[1];
      if (!traitPart || traitPart.trim().startsWith("!")) continue;
      const traitName = rustTypeName(traitPart);
      const trait =
        importedTraits.get(traitName) || uniqueSymbol(node, traitName, "trait");
      if (!trait) continue;
      addRelation(relations, {
        fromSourceSymbolId: implementation.id,
        toSourceSymbolId: trait.id,
        kind: "implements",
        evidence: [evidence(node, lines, implementation)],
        trust: "inferred",
        confidence: 0.93,
        resolver: "rust-static",
      });
      const traitNode = sourceNodes.find((candidate) =>
        candidate.symbols.some((symbol) => symbol.id === trait.id),
      );
      for (const method of node.symbols.filter(
        (symbol) =>
          symbol.kind === "method" && symbol.containerId === implementation.id,
      )) {
        const targets = (traitNode?.symbols || []).filter(
          (symbol) =>
            symbol.kind === "method" &&
            symbol.containerId === trait.id &&
            symbol.name === method.name,
        );
        if (targets.length !== 1) continue;
        addRelation(relations, {
          fromSourceSymbolId: method.id,
          toSourceSymbolId: targets[0].id,
          kind: "implements",
          evidence: [evidence(node, lines, method)],
          trust: "inferred",
          confidence: 0.9,
          resolver: "rust-static",
        });
      }
    }
  }
  return [...relations.values()].sort((a, b) =>
    relationKey(a).localeCompare(relationKey(b)),
  );
}
