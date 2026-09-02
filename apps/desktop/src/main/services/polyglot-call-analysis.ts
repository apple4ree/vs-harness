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
    if (
      (existing.sites?.length || 0) < 40 &&
      !existing.sites?.some(
        (item) =>
          item.evidence.path === site.evidence.path &&
          item.ordinal === site.ordinal,
      )
    )
      existing.sites!.push(site);
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

type CallableReference =
  | { kind: "symbol"; symbol: CodeSymbol }
  | { kind: "parameter"; owner: CodeSymbol; name: string }
  | { kind: "return"; callee: CallableReference };

type StaticInvocation = {
  owner?: CodeSymbol;
  callee: CallableReference;
  arguments: Array<{
    position: number;
    name?: string;
    reference: CallableReference;
  }>;
  site: ResolvedCallSite;
  rawArguments?: boolean;
  decoratorApplication?: boolean;
  invokeReturned?: boolean;
};

function splitTopLevel(text: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if ("([{<".includes(character)) depth++;
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function pythonParameters(symbol: CodeSymbol) {
  const body = symbol.signature?.match(/^[^(]*\((.*)\)\s*(?:->.*?)?:?$/)?.[1];
  if (body === undefined) return [];
  return splitTopLevel(body)
    .map((parameter) =>
      parameter
        .replace(/^\*{0,2}/, "")
        .split("=", 1)[0]
        .split(":", 1)[0]
        .trim(),
    )
    .filter(
      (parameter) =>
        /^[A-Za-z_]\w*$/.test(parameter) &&
        parameter !== "self" &&
        parameter !== "cls",
    );
}

function callArguments(text: string, openingParenthesis: number) {
  let depth = 0;
  for (let index = openingParenthesis; index < text.length; index++) {
    const character = text[index];
    if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth === 0)
        return splitTopLevel(text.slice(openingParenthesis + 1, index));
    }
  }
  return [];
}

function closingParenthesis(text: string, openingParenthesis: number) {
  let depth = 0;
  for (let index = openingParenthesis; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

function parameterBindingKey(owner: CodeSymbol, name: string) {
  return `${owner.id}:parameter:${name}`;
}

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
  const parameters = new Map<string, string[]>();
  const invocations: StaticInvocation[] = [];
  const returnedReferences = new Map<string, CallableReference[]>();
  const decoratorApplications: Array<{
    decorated: CodeSymbol;
    decorators: CodeSymbol[];
    owner?: CodeSymbol;
    site: ResolvedCallSite;
  }> = [];
  const classes = sourceNodes.flatMap((node) =>
    node.symbols.filter((symbol) => symbol.kind === "class"),
  );
  const uniqueClass = (name: string) => {
    const matches = classes.filter((symbol) => symbol.name === name);
    return matches.length === 1 ? matches[0] : null;
  };
  const parents = new Map<string, CodeSymbol[]>();
  const children = new Map<string, CodeSymbol[]>();
  for (const child of classes) {
    const baseList = child.signature?.match(/^class\s+\w+\s*\((.*)\)\s*:/)?.[1];
    if (!baseList) continue;
    for (const baseName of splitTopLevel(baseList)) {
      const parent = uniqueClass(
        baseName.replace(/\[[^\]]*\]/g, "").trim().split(".").at(-1) || "",
      );
      if (!parent || parent.id === child.id) continue;
      const currentParents = parents.get(child.id) || [];
      currentParents.push(parent);
      parents.set(child.id, currentParents);
      const currentChildren = children.get(parent.id) || [];
      currentChildren.push(child);
      children.set(parent.id, currentChildren);
    }
  }
  for (const node of sourceNodes)
    for (const symbol of node.symbols)
      if (callable(symbol)) parameters.set(symbol.id, pythonParameters(symbol));
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
    const aliases = new Map<string, Map<string, CallableReference>>();
    const receivers = new Map<string, Map<string, CodeSymbol>>();
    const aliasScope = (owner?: CodeSymbol) => owner?.id || `module:${file}`;
    const aliasMap = (key: string) => {
      const current = aliases.get(key) || new Map<string, CallableReference>();
      aliases.set(key, current);
      return current;
    };
    const receiverMap = (key: string) => {
      const current = receivers.get(key) || new Map<string, CodeSymbol>();
      receivers.set(key, current);
      return current;
    };
    const resolveReference = (
      name: string,
      owner?: CodeSymbol,
    ): CallableReference | null => {
      const localAlias =
        aliases.get(aliasScope(owner))?.get(name) ||
        (owner ? aliases.get(`module:${file}`)?.get(name) : undefined);
      if (localAlias) return localAlias;
      if (owner?.containerId && name.startsWith("self.")) {
        const memberAlias = aliases
          .get(`container:${owner.containerId}`)
          ?.get(name);
        if (memberAlias) return memberAlias;
      }
      const parts = name.split(".");
      if (parts.length > 1) {
        const receiverName = parts.slice(0, -1).join(".");
        const receiver =
          receivers.get(aliasScope(owner))?.get(receiverName) ||
          (owner
            ? receivers.get(`module:${file}`)?.get(receiverName)
            : undefined) ||
          (owner?.containerId
            ? receivers
                .get(`container:${owner.containerId}`)
                ?.get(receiverName)
            : undefined);
        if (receiver) {
          const receiverNode = sourceNodes.find((candidate) =>
            candidate.symbols.some((item) => item.id === receiver.id),
          );
          const target = oneSymbol(
            receiverNode,
            parts.at(-1)!,
            receiver.id,
          );
          if (target) return { kind: "symbol", symbol: target };
        }
      }
      if (parts.length === 1) {
        const parameterOwner = owner
          ? [
              owner,
              ...node.symbols
                .filter(
                  (candidate) =>
                    callable(candidate) &&
                    candidate.id !== owner.id &&
                    candidate.line < owner.line &&
                    candidate.endLine >= owner.endLine,
                )
                .sort(
                  (left, right) =>
                    left.endLine - left.line - (right.endLine - right.line),
                ),
            ].find((candidate) =>
              (parameters.get(candidate.id) || []).includes(name),
            )
          : undefined;
        if (parameterOwner)
          return { kind: "parameter", owner: parameterOwner, name };
        const target =
          importedItems.get(name) ||
          (owner ? oneSymbol(node, name, owner.id) : null) ||
          oneSymbol(node, name);
        return target ? { kind: "symbol", symbol: target } : null;
      }
      if (parts.length === 2 && parts[0] === "self" && owner?.containerId) {
        const target = oneSymbol(node, parts[1], owner.containerId);
        return target ? { kind: "symbol", symbol: target } : null;
      }
      if (parts.length === 2 && importedModules.has(parts[0])) {
        const target = oneSymbol(importedModules.get(parts[0]), parts[1]);
        return target ? { kind: "symbol", symbol: target } : null;
      }
      if (parts.length === 2) {
        const classSymbol =
          node.symbols.find(
            (item) => item.kind === "class" && item.name === parts[0],
          ) || importedItems.get(parts[0]);
        if (classSymbol) {
          const classNode = sourceNodes.find((candidate) =>
            candidate.symbols.some((item) => item.id === classSymbol.id),
          );
          const target = oneSymbol(classNode, parts[1], classSymbol.id);
          return target ? { kind: "symbol", symbol: target } : null;
        }
      }
      return null;
    };
    // Collect class field aliases before scanning calls so a base-class method
    // can see assignments declared later in derived constructors.
    for (let index = 0; index < code.length; index++) {
      const owner = ownerAtLine(node, index + 1);
      if (!owner?.containerId) continue;
      const memberAlias = code[index]
        .trim()
        .match(/^self\.([A-Za-z_]\w*)\s*=\s*self\.([A-Za-z_]\w*)\s*$/);
      if (!memberAlias) continue;
      const target = oneSymbol(node, memberAlias[2], owner.containerId);
      if (target)
        aliasMap(`container:${owner.containerId}`).set(`self.${memberAlias[1]}`, {
          kind: "symbol",
          symbol: target,
        });
    }
    for (const decorated of node.symbols.filter(
      (symbol) => callable(symbol) && Boolean(symbol.decorators?.length),
    )) {
      const decorators: CodeSymbol[] = [];
      const lexicalOwner = decorated.containerId
        ? node.symbols.find(
            (symbol) =>
              symbol.id === decorated.containerId && callable(symbol),
          )
        : undefined;
      for (const decoratorText of decorated.decorators || []) {
        const decoratorName = decoratorText.match(
          /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/,
        )?.[1];
        if (!decoratorName) continue;
        const decorator = resolveReference(decoratorName, lexicalOwner);
        if (!decorator || decorator.kind !== "symbol") continue;
        decorators.push(decorator.symbol);
      }
      if (!decorators.length) continue;
      const decoratorLine = Math.max(1, decorated.line - 1);
      decoratorApplications.push({
        decorated,
        decorators,
        ...(lexicalOwner ? { owner: lexicalOwner } : {}),
        site: {
          evidence: evidence(node, original, decoratorLine),
          ordinal: decoratorLine * 10_000,
        },
      });
    }
    const descendantMethods = (owner: CodeSymbol, name: string) => {
      if (!owner.containerId) return [];
      const output = new Map<string, CodeSymbol>();
      const pending = [...(children.get(owner.containerId) || [])];
      const seen = new Set<string>();
      while (pending.length && output.size < 8) {
        const child = pending.shift()!;
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        const childNode = sourceNodes.find((candidate) =>
          candidate.symbols.some((symbol) => symbol.id === child.id),
        );
        const method = oneSymbol(childNode, name, child.id);
        if (method) output.set(method.id, method);
        const aliased = aliases
          .get(`container:${child.id}`)
          ?.get(`self.${name}`);
        if (aliased?.kind === "symbol")
          output.set(aliased.symbol.id, aliased.symbol);
        pending.push(...(children.get(child.id) || []));
      }
      return [...output.values()];
    };
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
      const returnedAssignment = trimmed.match(
        /^(self\.)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(\s*\)\s*$/,
      );
      if (returnedAssignment) {
        const callee = resolveReference(returnedAssignment[3], owner);
        if (callee) {
          const key =
            returnedAssignment[1] && owner?.containerId
              ? `container:${owner.containerId}`
              : aliasScope(owner);
          aliasMap(key).set(
            returnedAssignment[1]
              ? `self.${returnedAssignment[2]}`
              : returnedAssignment[2],
            { kind: "return", callee },
          );
        }
      }
      const assignment = trimmed.match(
        /^(self\.)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/,
      );
      if (assignment) {
        const reference = resolveReference(assignment[3], owner);
        if (reference) {
          const key =
            assignment[1] && owner?.containerId
              ? `container:${owner.containerId}`
              : aliasScope(owner);
          aliasMap(key).set(
            assignment[1] ? `self.${assignment[2]}` : assignment[2],
            reference,
          );
        }
      }
      const receiverAlias = trimmed.match(
        /^([A-Za-z_]\w*)\s*=\s*self\s*$/,
      );
      if (receiverAlias && owner?.containerId) {
        const container = node.symbols.find(
          (symbol) => symbol.id === owner.containerId,
        );
        if (container)
          receiverMap(aliasScope(owner)).set(receiverAlias[1], container);
      }
      const constructedReceiver = trimmed.match(
        /^(self\.)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(/,
      );
      if (constructedReceiver) {
        const container =
          node.symbols.find(
            (symbol) =>
              symbol.kind === "class" && symbol.name === constructedReceiver[3],
          ) || importedItems.get(constructedReceiver[3]);
        if (container?.kind === "class") {
          const key =
            constructedReceiver[1] && owner?.containerId
              ? `container:${owner.containerId}`
              : aliasScope(owner);
          receiverMap(key).set(
            constructedReceiver[1]
              ? `self.${constructedReceiver[2]}`
              : constructedReceiver[2],
            container,
          );
        }
      }
      const returned = trimmed.match(
        /^return\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/,
      );
      if (returned && owner) {
        const reference = resolveReference(returned[1], owner);
        if (reference) {
          const current = returnedReferences.get(owner.id) || [];
          current.push(reference);
          returnedReferences.set(owner.id, current);
        }
      }
      const returnedCall = trimmed.match(
        /^return\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(\s*\)\s*$/,
      );
      if (returnedCall && owner) {
        const callee = resolveReference(returnedCall[1], owner);
        if (callee) {
          const current = returnedReferences.get(owner.id) || [];
          current.push({ kind: "return", callee });
          returnedReferences.set(owner.id, current);
        }
      }
      const definition = text.match(/^\s*(?:async\s+)?def\s+\w+.*?:/);
      if (definition) text = text.slice(text.indexOf(":") + 1);
      const retry = owner
        ? activeRetry || pythonRetryDecorator(node, owner, original)
        : undefined;
      if (owner?.containerId) {
        const superCall = text.match(/\bsuper\(\)\.([A-Za-z_]\w*)\s*\(/);
        const parent = parents.get(owner.containerId)?.[0];
        if (superCall && parent) {
          const parentNode = sourceNodes.find((candidate) =>
            candidate.symbols.some((symbol) => symbol.id === parent.id),
          );
          const target = oneSymbol(parentNode, superCall[1], parent.id);
          if (target)
            addCall(
              calls,
              owner,
              target,
              {
                evidence: evidence(node, original, line),
                ordinal: line * 10_000 + (superCall.index || 0),
                ...(activeBranch ? { branch: activeBranch } : {}),
                ...(retry ? { retry } : {}),
              },
              "python-static",
              0.92,
            );
        }
      }
      const expression = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g;
      for (const match of text.matchAll(expression)) {
        const name = match[1];
        if (pythonExcluded.has(name.split(".")[0])) continue;
        const reference = resolveReference(name, owner);
        const siteEvidence = evidence(node, original, line);
        const site: ResolvedCallSite = {
          evidence: siteEvidence,
          ordinal: line * 10_000 + (match.index || 0),
          ...(activeBranch ? { branch: activeBranch } : {}),
          ...(retry ? { retry } : {}),
        };
        if (!reference) {
          if (owner && name.startsWith("self."))
            for (const target of descendantMethods(
              owner,
              name.split(".").at(-1)!,
            ))
              addCall(
                calls,
                owner,
                target,
                site,
                "python-static",
                0.64,
              );
          continue;
        }
        const openingParenthesis =
          (match.index || 0) + match[0].lastIndexOf("(");
        const closing = closingParenthesis(text, openingParenthesis);
        const argumentReferences = callArguments(text, openingParenthesis)
          .map((argument, position) => {
            const keyword = argument.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
            const value = (keyword?.[2] || argument)
              .replace(/^\*{1,2}/, "")
              .trim();
            if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(value)) return null;
            const argumentReference = resolveReference(value, owner);
            return argumentReference
              ? {
                  position,
                  ...(keyword ? { name: keyword[1] } : {}),
                  reference: argumentReference,
                }
              : null;
          })
          .filter(
            (
              argument,
            ): argument is {
              position: number;
              name?: string;
              reference: CallableReference;
            } => Boolean(argument),
          );
        invocations.push({
          ...(owner ? { owner } : {}),
          callee: reference,
          arguments: argumentReferences,
          site,
          ...(closing >= 0 && /^\s*\(/.test(text.slice(closing + 1))
            ? { invokeReturned: true }
            : {}),
        });
        if (
          owner &&
          reference.kind === "symbol" &&
          !(reference.symbol.decorators || []).length
        ) {
          const target = reference.symbol;
          const confidence = importedItems.has(name)
            ? 0.92
            : name.startsWith("self.")
              ? 0.84
              : 0.9;
          addCall(calls, owner, target, site, "python-static", confidence);
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
  const bindings = new Map<string, Map<string, CodeSymbol>>();
  const rawParameterBindings = new Set<string>();
  const plainTargetsFor = (reference: CallableReference) => {
    const expand = (
      current: CallableReference,
      seen: Set<string>,
    ): CodeSymbol[] => {
      if (current.kind === "symbol") return [current.symbol];
      if (current.kind === "parameter")
        return [
          ...(bindings
            .get(parameterBindingKey(current.owner, current.name))
            ?.values() || []),
        ];
      const callees = expand(current.callee, seen);
      const output = new Map<string, CodeSymbol>();
      for (const callee of callees) {
        if (seen.has(callee.id)) continue;
        const nextSeen = new Set(seen).add(callee.id);
        for (const returned of returnedReferences.get(callee.id) || [])
          for (const target of expand(returned, nextSeen))
            output.set(target.id, target);
      }
      return [...output.values()];
    };
    return expand(reference, new Set());
  };
  const decoratedOutputs = new Map<string, CallableReference[]>();
  for (const application of decoratorApplications) {
    let current: CallableReference[] = [
      { kind: "symbol", symbol: application.decorated },
    ];
    // Python applies @outer / @inner bottom-up: inner(function), then
    // outer(the value returned by inner).
    for (const decorator of [...application.decorators].reverse()) {
      for (const reference of current)
        invocations.push({
          ...(application.owner ? { owner: application.owner } : {}),
          callee: { kind: "symbol", symbol: decorator },
          arguments: [{ position: 0, reference }],
          site: application.site,
          rawArguments: true,
          decoratorApplication: true,
        });
      const returned = returnedReferences.get(decorator.id) || [];
      if (!returned.length) continue;
      const firstParameter = (parameters.get(decorator.id) || [])[0];
      current = returned.flatMap((reference) =>
        reference.kind === "parameter" &&
        reference.owner.id === decorator.id &&
        reference.name === firstParameter
          ? current
          : [reference],
      );
    }
    decoratedOutputs.set(application.decorated.id, current);
  }
  const targetsFor = (reference: CallableReference) => {
    const targets = plainTargetsFor(reference);
    if (
      reference.kind === "parameter" &&
      rawParameterBindings.has(
        parameterBindingKey(reference.owner, reference.name),
      )
    )
      return targets;
    const output = new Map<string, CodeSymbol>();
    for (const target of targets) {
      const returned = (decoratedOutputs.get(target.id) || []).flatMap(
        (reference) => plainTargetsFor(reference),
      );
      for (const resolved of returned.length ? returned : [target])
        output.set(resolved.id, resolved);
    }
    return [...output.values()];
  };
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (const invocation of invocations) {
      const callees = targetsFor(invocation.callee);
      for (const callee of callees) {
        if (
          invocation.owner &&
          (invocation.callee.kind === "parameter" ||
            invocation.callee.kind === "return" ||
            invocation.decoratorApplication ||
            (invocation.callee.kind === "symbol" &&
              Boolean(invocation.callee.symbol.decorators?.length)))
        )
          addCall(
            calls,
            invocation.owner,
            callee,
            invocation.site,
            "python-static",
            invocation.callee.kind === "parameter"
              ? 0.76
              : invocation.decoratorApplication
                ? 0.9
                : 0.72,
          );
        if (invocation.owner && invocation.invokeReturned)
          for (const returned of returnedReferences.get(callee.id) || [])
            for (const target of targetsFor(returned))
              addCall(
                calls,
                invocation.owner,
                target,
                invocation.site,
                "python-static",
                0.7,
              );
        const names = parameters.get(callee.id) || [];
        for (const argument of invocation.arguments) {
          const parameter = argument.name || names[argument.position];
          if (!parameter || !names.includes(parameter)) continue;
          const key = parameterBindingKey(callee, parameter);
          const current = bindings.get(key) || new Map<string, CodeSymbol>();
          bindings.set(key, current);
          if (invocation.rawArguments) rawParameterBindings.add(key);
          if (current.size >= 24) continue;
          for (const target of invocation.rawArguments
            ? plainTargetsFor(argument.reference)
            : targetsFor(argument.reference))
            if (!current.has(target.id)) {
              current.set(target.id, target);
              changed = true;
            }
        }
      }
    }
    if (!changed) break;
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
