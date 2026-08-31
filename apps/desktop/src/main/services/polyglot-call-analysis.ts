import type {
  ArchitectureNode,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type {
  ResolvedCallControl,
  ResolvedCallSite,
  ResolvedSymbolCall,
} from "./semantic-analysis";

type ResolveImport = (file: string, specifier: string) => string | null;
type ControlBlock = {
  level: number;
  branch?: ResolvedCallControl;
  retry?: ResolvedCallControl;
  matchId?: string;
};

const callable = (symbol: CodeSymbol) =>
  ["function", "method", "component"].includes(symbol.kind);

function ownerAtLine(node: ArchitectureNode, line: number) {
  return node.symbols
    .filter(
      (symbol) =>
        callable(symbol) && symbol.line <= line && symbol.endLine >= line,
    )
    .sort(
      (a, b) => a.endLine - a.line - (b.endLine - b.line) || b.line - a.line,
    )[0];
}

function oneSymbol(
  node: ArchitectureNode | undefined,
  name: string,
  containerId?: string,
) {
  if (!node) return null;
  const matches = node.symbols.filter(
    (symbol) =>
      callable(symbol) &&
      symbol.name === name &&
      (containerId === undefined
        ? !symbol.containerId
        : symbol.containerId === containerId),
  );
  return matches.length === 1 ? matches[0] : null;
}

function evidence(
  node: ArchitectureNode,
  lines: string[],
  line: number,
): SourceEvidence {
  return {
    path: node.id,
    line,
    hash: node.hash,
    excerpt: lines[line - 1]?.trim().slice(0, 300),
  };
}

function addCall(
  calls: Map<string, ResolvedSymbolCall>,
  from: CodeSymbol,
  to: CodeSymbol,
  site: ResolvedCallSite,
  resolver: "python-static" | "rust-static",
  confidence: number,
) {
  if (from.id === to.id || calls.size >= 10_000) return;
  const key = `${from.id}->${to.id}`;
  const existing = calls.get(key);
  if (existing) {
    if (
      existing.evidence.length < 20 &&
      !existing.evidence.some(
        (item) =>
          item.path === site.evidence.path && item.line === site.evidence.line,
      )
    )
      existing.evidence.push(site.evidence);
    if ((existing.sites?.length || 0) < 40) existing.sites!.push(site);
    existing.confidence = Math.min(
      existing.confidence || confidence,
      confidence,
    );
    return;
  }
  calls.set(key, {
    fromSourceSymbolId: from.id,
    toSourceSymbolId: to.id,
    evidence: [site.evidence],
    trust: "inferred",
    confidence,
    resolver,
    sites: [site],
  });
}

function pythonCodeLines(content: string) {
  const output: string[] = [];
  let triple: "'''" | '"""' | null = null;
  for (const source of content.split(/\r?\n/)) {
    let result = "";
    let index = 0;
    while (index < source.length) {
      if (triple) {
        const end = source.indexOf(triple, index);
        if (end < 0) {
          result += " ".repeat(source.length - index);
          index = source.length;
        } else {
          result += " ".repeat(end + 3 - index);
          index = end + 3;
          triple = null;
        }
        continue;
      }
      const three = source.slice(index, index + 3);
      if (three === "'''" || three === '"""') {
        triple = three;
        result += "   ";
        index += 3;
        continue;
      }
      const character = source[index];
      if (character === "#") {
        result += " ".repeat(source.length - index);
        break;
      }
      if (character === "'" || character === '"') {
        const quote = character;
        result += " ";
        index++;
        while (index < source.length) {
          const current = source[index];
          result += " ";
          index++;
          if (current === "\\" && index < source.length) {
            result += " ";
            index++;
          } else if (current === quote) break;
        }
        continue;
      }
      result += character;
      index++;
    }
    output.push(result);
  }
  return output;
}

function rustCodeLines(content: string) {
  const output: string[] = [];
  let blockDepth = 0;
  for (const source of content.split(/\r?\n/)) {
    let result = "";
    let index = 0;
    while (index < source.length) {
      const pair = source.slice(index, index + 2);
      if (blockDepth) {
        if (pair === "/*") {
          blockDepth++;
          result += "  ";
          index += 2;
        } else if (pair === "*/") {
          blockDepth--;
          result += "  ";
          index += 2;
        } else {
          result += " ";
          index++;
        }
        continue;
      }
      if (pair === "//") {
        result += " ".repeat(source.length - index);
        break;
      }
      if (pair === "/*") {
        blockDepth = 1;
        result += "  ";
        index += 2;
        continue;
      }
      const character = source[index];
      if (character === '"') {
        result += " ";
        index++;
        while (index < source.length) {
          const current = source[index];
          result += " ";
          index++;
          if (current === "\\" && index < source.length) {
            result += " ";
            index++;
          } else if (current === '"') break;
        }
        continue;
      }
      result += character;
      index++;
    }
    output.push(result);
  }
  return output;
}

const pythonExcluded = new Set([
  "and",
  "assert",
  "async",
  "await",
  "bool",
  "class",
  "dict",
  "enumerate",
  "except",
  "float",
  "for",
  "if",
  "int",
  "len",
  "list",
  "map",
  "max",
  "min",
  "next",
  "print",
  "range",
  "return",
  "set",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "while",
  "with",
  "zip",
]);

function pythonRetryDecorator(
  node: ArchitectureNode,
  owner: CodeSymbol,
  original: string[],
) {
  if (
    !(owner.decorators || []).some((item) => /\b(retry|backoff)\b/i.test(item))
  )
    return undefined;
  for (
    let line = owner.line - 1;
    line >= Math.max(1, owner.line - 12);
    line--
  ) {
    const text = original[line - 1]?.trim() || "";
    if (/^@.*\b(retry|backoff)\b/i.test(text)) {
      const attempts = text.match(/(?:attempt|tries|max_tries)\D{0,12}(\d+)/i);
      return {
        id: `${node.id}:retry:decorator:${line}`,
        kind: "retry" as const,
        label: text.slice(0, 180),
        evidence: evidence(node, original, line),
        ...(attempts ? { maxAttempts: Number(attempts[1]) } : {}),
      };
    }
  }
  return undefined;
}

export async function pythonResolvedCalls(
  sourceNodes: ArchitectureNode[],
  sourceTexts: Map<string, string>,
  resolveImport: ResolveImport,
  signal?: AbortSignal,
) {
  const nodes = new Map(sourceNodes.map((node) => [node.id, node]));
  const calls = new Map<string, ResolvedSymbolCall>();
  for (const [fileIndex, [file, content]] of [...sourceTexts].entries()) {
    signal?.throwIfAborted();
    if (fileIndex && fileIndex % 24 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const node = nodes.get(file);
    if (!node) continue;
    const original = content.split(/\r?\n/);
    const code = pythonCodeLines(content);
    const importedItems = new Map<string, CodeSymbol>();
    const importedModules = new Map<string, ArchitectureNode>();
    for (const line of code) {
      const from = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
      if (from) {
        const target = nodes.get(resolveImport(file, from[1]) || "");
        for (const entry of from[2].replace(/[()]/g, "").split(",")) {
          const match = entry.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (!match || !target) continue;
          const symbol = target.symbols.filter(
            (item) => item.name === match[1] && !item.containerId,
          );
          if (symbol.length === 1)
            importedItems.set(match[2] || match[1], symbol[0]);
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
          importedModules.set(match[2] || match[1], target);
      }
    }
    const blocks: ControlBlock[] = [];
    const branchAtIndent = new Map<number, string>();
    const indentation = (text: string) =>
      (text.match(/^\s*/)?.[0] || "").replaceAll("\t", "    ").length;
    for (let index = 0; index < code.length; index++) {
      signal?.throwIfAborted();
      const line = index + 1;
      let text = code[index];
      const trimmed = text.trim();
      if (!trimmed) continue;
      const indent = indentation(text);
      while (blocks.length && indent <= blocks.at(-1)!.level) blocks.pop();
      const activeBranch = [...blocks]
        .reverse()
        .find((item) => item.branch)?.branch;
      const activeRetry = [...blocks]
        .reverse()
        .find((item) => item.retry)?.retry;
      const owner = ownerAtLine(node, line);
      const definition = text.match(/^\s*(?:async\s+)?def\s+\w+.*?:/);
      if (definition) text = text.slice(text.indexOf(":") + 1);
      if (owner) {
        const retry =
          activeRetry || pythonRetryDecorator(node, owner, original);
        const expression = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g;
        for (const match of text.matchAll(expression)) {
          const name = match[1];
          const parts = name.split(".");
          if (pythonExcluded.has(parts[0])) continue;
          let target: CodeSymbol | null = null;
          let confidence = 0.9;
          if (parts.length === 1) {
            target = importedItems.get(name) || oneSymbol(node, name);
            confidence = importedItems.has(name) ? 0.92 : 0.9;
          } else if (
            parts.length === 2 &&
            parts[0] === "self" &&
            owner.containerId
          ) {
            target = oneSymbol(node, parts[1], owner.containerId);
            confidence = 0.84;
          } else if (parts.length === 2 && importedModules.has(parts[0])) {
            target = oneSymbol(importedModules.get(parts[0]), parts[1]);
            confidence = 0.91;
          } else if (parts.length === 2) {
            const classSymbol =
              node.symbols.find(
                (item) => item.kind === "class" && item.name === parts[0],
              ) || importedItems.get(parts[0]);
            if (classSymbol) {
              const classNode = sourceNodes.find((candidate) =>
                candidate.symbols.some((item) => item.id === classSymbol.id),
              );
              target = oneSymbol(classNode, parts[1], classSymbol.id);
              confidence = 0.84;
            }
          }
          if (!target || !callable(target)) continue;
          const siteEvidence = evidence(node, original, line);
          addCall(
            calls,
            owner,
            target,
            {
              evidence: siteEvidence,
              ordinal: line * 10_000 + (match.index || 0),
              ...(activeBranch ? { branch: activeBranch } : {}),
              ...(retry ? { retry } : {}),
            },
            "python-static",
            confidence,
          );
        }
      }
      const branchHeader = trimmed.match(/^(if|elif|else)\b(.*):\s*$/);
      if (branchHeader) {
        const group =
          branchHeader[1] === "if"
            ? `${file}:branch:${line}`
            : branchAtIndent.get(indent) || `${file}:branch:${line}`;
        branchAtIndent.set(indent, group);
        blocks.push({
          level: indent,
          branch: {
            id: group,
            kind: "branch",
            label: trimmed.slice(0, 180),
            arm: branchHeader[1] === "else" ? "else" : trimmed.slice(0, 180),
            evidence: evidence(node, original, line),
          },
        });
      }
      const retryHeader = trimmed.match(/^(for|while)\b(.*):\s*$/);
      if (
        retryHeader &&
        (/(?:^|[^a-z0-9])(?:retry|retries|attempt|attempts|backoff)(?:[^a-z0-9]|$)/i.test(
          trimmed,
        ) ||
          /(?:^|[^a-z0-9])(?:retry|retries|attempt|attempts|backoff)(?:[^a-z0-9]|$)/i.test(
            owner?.qualifiedName || owner?.name || "",
          ))
      ) {
        const oneArgument = trimmed.match(/range\(\s*(\d+)\s*\)/);
        const twoArguments = trimmed.match(/range\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
        const maxAttempts = twoArguments
          ? Math.max(0, Number(twoArguments[2]) - Number(twoArguments[1]))
          : oneArgument
            ? Number(oneArgument[1])
            : undefined;
        blocks.push({
          level: indent,
          retry: {
            id: `${file}:retry:${line}`,
            kind: "retry",
            label: trimmed.slice(0, 180),
            evidence: evidence(node, original, line),
            ...(maxAttempts !== undefined ? { maxAttempts } : {}),
          },
        });
      }
    }
  }
  return [...calls.values()]
    .map((call) => ({
      ...call,
      evidence: [...call.evidence].sort((a, b) => a.line - b.line),
      sites: [...(call.sites || [])].sort((a, b) => a.ordinal - b.ordinal),
    }))
    .sort(
      (a, b) =>
        a.fromSourceSymbolId.localeCompare(b.fromSourceSymbolId) ||
        a.toSourceSymbolId.localeCompare(b.toSourceSymbolId),
    );
}

const rustExcluded = new Set([
  "as",
  "break",
  "continue",
  "drop",
  "else",
  "for",
  "format",
  "if",
  "loop",
  "match",
  "panic",
  "return",
  "sizeof",
  "todo",
  "unimplemented",
  "vec",
  "while",
]);

function implementationFor(node: ArchitectureNode, owner: CodeSymbol) {
  return owner.containerId
    ? node.symbols.find(
        (symbol) =>
          symbol.id === owner.containerId && symbol.kind === "implementation",
      )
    : undefined;
}

function rustImplementationMethod(
  node: ArchitectureNode,
  owner: CodeSymbol,
  receiver: string,
  method: string,
) {
  if (receiver === "self" || receiver === "Self") {
    const container = implementationFor(node, owner);
    return container ? oneSymbol(node, method, container.id) : null;
  }
  const implementations = node.symbols.filter(
    (symbol) =>
      symbol.kind === "implementation" &&
      new RegExp(
        `(?:impl\\s+|for\\s+)${receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
      ).test(symbol.name),
  );
  const methods = implementations.flatMap((container) => {
    const target = oneSymbol(node, method, container.id);
    return target ? [target] : [];
  });
  return methods.length === 1 ? methods[0] : null;
}

export async function rustResolvedCalls(
  sourceNodes: ArchitectureNode[],
  sourceTexts: Map<string, string>,
  resolveImport: ResolveImport,
  signal?: AbortSignal,
) {
  const nodes = new Map(sourceNodes.map((node) => [node.id, node]));
  const calls = new Map<string, ResolvedSymbolCall>();
  for (const [fileIndex, [file, content]] of [...sourceTexts].entries()) {
    signal?.throwIfAborted();
    if (fileIndex && fileIndex % 24 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const node = nodes.get(file);
    if (!node) continue;
    const original = content.split(/\r?\n/);
    const code = rustCodeLines(content);
    const importedItems = new Map<string, CodeSymbol>();
    const moduleAliases = new Map<string, ArchitectureNode>();
    const bindImport = (specifier: string, alias?: string) => {
      const normalized = specifier.trim().replace(/^::/, "");
      const targetNode = nodes.get(resolveImport(file, normalized) || "");
      if (!targetNode) return;
      const parts = normalized.split("::").filter(Boolean);
      const targetName = parts.at(-1)!;
      const targets = targetNode.symbols.filter(
        (symbol) => symbol.name === targetName && !symbol.containerId,
      );
      if (targets.length === 1 && callable(targets[0]))
        importedItems.set(alias || targetName, targets[0]);
      else moduleAliases.set(alias || targetName, targetNode);
    };
    for (const line of code) {
      const module = line.trim().match(/^(?:pub\s+)?mod\s+(\w+)\s*;/);
      if (module) bindImport(`self::${module[1]}`, module[1]);
      const imported = line.trim().match(/^(?:pub\s+)?use\s+(.+);/);
      if (!imported) continue;
      const body = imported[1].trim();
      const braces = body.match(/^(.*)::\{(.+)\}$/);
      if (braces) {
        for (const item of braces[2].split(",")) {
          const match = item.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (match) bindImport(`${braces[1]}::${match[1]}`, match[2]);
        }
      } else {
        const match = body.match(/^(.+?)(?:\s+as\s+(\w+))?$/);
        if (match) bindImport(match[1], match[2]);
      }
    }
    let depth = 0;
    const blocks: ControlBlock[] = [];
    const branchAtDepth = new Map<number, string>();
    for (let index = 0; index < code.length; index++) {
      signal?.throwIfAborted();
      const line = index + 1;
      let text = code[index];
      const trimmed = text.trim();
      if (!trimmed) continue;
      const leadingClosures = trimmed.match(/^\}+/)?.[0].length || 0;
      const effectiveDepth = Math.max(0, depth - leadingClosures);
      while (blocks.length && effectiveDepth <= blocks.at(-1)!.level)
        blocks.pop();
      const outerBranch = [...blocks]
        .reverse()
        .find((item) => item.branch)?.branch;
      const outerRetry = [...blocks]
        .reverse()
        .find((item) => item.retry)?.retry;
      const activeMatch = [...blocks]
        .reverse()
        .find((item) => item.matchId)?.matchId;
      const header = trimmed.replace(/^\}+\s*/, "");
      const branchHeader = header.match(/^(if|else\s+if|else)\b(.*)\{/);
      const armHeader = activeMatch && header.match(/^(.+?)=>\s*(.*)$/);
      let enteredBranch: ResolvedCallControl | undefined;
      if (branchHeader) {
        const group =
          branchHeader[1] === "if"
            ? `${file}:branch:${line}`
            : branchAtDepth.get(effectiveDepth) || `${file}:branch:${line}`;
        branchAtDepth.set(effectiveDepth, group);
        enteredBranch = {
          id: group,
          kind: "branch",
          label: header.slice(0, 180),
          arm: branchHeader[1] === "else" ? "else" : header.slice(0, 180),
          evidence: evidence(node, original, line),
        };
      } else if (armHeader) {
        enteredBranch = {
          id: activeMatch,
          kind: "branch",
          label: `match · ${armHeader[1].trim()}`.slice(0, 180),
          arm: armHeader[1].trim().slice(0, 180),
          evidence: evidence(node, original, line),
        };
      }
      const owner = ownerAtLine(node, line);
      const retryHeader = header.match(/^(for|while|loop)\b(.*)\{/);
      let enteredRetry: ResolvedCallControl | undefined;
      if (
        retryHeader &&
        (/(?:^|[^a-z0-9])(?:retry|retries|attempt|attempts|backoff)(?:[^a-z0-9]|$)/i.test(
          header,
        ) ||
          /(?:^|[^a-z0-9])(?:retry|retries|attempt|attempts|backoff)(?:[^a-z0-9]|$)/i.test(
            owner?.qualifiedName || owner?.name || "",
          ))
      ) {
        const range = header.match(/(\d+)\s*\.\.(=)?\s*(\d+)/);
        const maxAttempts = range
          ? Math.max(
              0,
              Number(range[3]) - Number(range[1]) + (range[2] ? 1 : 0),
            )
          : undefined;
        enteredRetry = {
          id: `${file}:retry:${line}`,
          kind: "retry",
          label: header.slice(0, 180),
          evidence: evidence(node, original, line),
          ...(maxAttempts !== undefined ? { maxAttempts } : {}),
        };
      }
      const definition = text.match(/\bfn\s+\w+/);
      if (definition && text.includes("{"))
        text = text.slice(text.indexOf("{") + 1);
      if (armHeader && text.includes("=>"))
        text = text.slice(text.indexOf("=>") + 2);
      if (owner) {
        const expression =
          /\b([A-Za-z_]\w*(?:(?:::|\.)[A-Za-z_]\w*)*)\s*(?:::\s*<[^>\n]+>)?\s*\(/g;
        for (const match of text.matchAll(expression)) {
          const name = match[1];
          const normalized = name.replaceAll(".", "::");
          const parts = normalized.split("::");
          if (
            rustExcluded.has(parts[0]) ||
            text.slice(0, match.index).endsWith("!")
          )
            continue;
          let target: CodeSymbol | null = null;
          let confidence = 0.92;
          if (parts.length === 1) {
            target = importedItems.get(name) || oneSymbol(node, name);
          } else if (
            parts.length === 2 &&
            ["self", "Self"].includes(parts[0])
          ) {
            target = rustImplementationMethod(node, owner, parts[0], parts[1]);
            confidence = parts[0] === "Self" ? 0.9 : 0.85;
          } else if (parts.length === 2 && moduleAliases.has(parts[0])) {
            target = oneSymbol(moduleAliases.get(parts[0]), parts[1]);
          } else if (parts.length === 2) {
            target = rustImplementationMethod(node, owner, parts[0], parts[1]);
            confidence = 0.88;
          } else {
            const targetNode = nodes.get(resolveImport(file, normalized) || "");
            target = oneSymbol(targetNode, parts.at(-1)!);
            confidence = 0.94;
          }
          if (!target || !callable(target)) continue;
          const siteEvidence = evidence(node, original, line);
          addCall(
            calls,
            owner,
            target,
            {
              evidence: siteEvidence,
              ordinal: line * 10_000 + (match.index || 0),
              ...(enteredBranch || outerBranch
                ? { branch: enteredBranch || outerBranch }
                : {}),
              ...(enteredRetry || outerRetry
                ? { retry: enteredRetry || outerRetry }
                : {}),
            },
            "rust-static",
            confidence,
          );
        }
      }
      if (/^match\b.*\{/.test(header))
        blocks.push({
          level: effectiveDepth,
          matchId: `${file}:branch:${line}`,
        });
      if (enteredBranch)
        blocks.push({ level: effectiveDepth, branch: enteredBranch });
      if (enteredRetry)
        blocks.push({ level: effectiveDepth, retry: enteredRetry });
      depth += (code[index].match(/\{/g) || []).length;
      depth -= (code[index].match(/\}/g) || []).length;
      depth = Math.max(0, depth);
    }
  }
  return [...calls.values()]
    .map((call) => ({
      ...call,
      evidence: [...call.evidence].sort((a, b) => a.line - b.line),
      sites: [...(call.sites || [])].sort((a, b) => a.ordinal - b.ordinal),
    }))
    .sort(
      (a, b) =>
        a.fromSourceSymbolId.localeCompare(b.fromSourceSymbolId) ||
        a.toSourceSymbolId.localeCompare(b.toSourceSymbolId),
    );
}
