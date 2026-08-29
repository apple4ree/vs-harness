import ts from "typescript";
import path from "node:path";
import {
  listWorkspace,
  readWorkspaceText,
  TEXT_LIMIT,
} from "./workspace-files";
import type { SymbolSearchResult, WorkspaceSearch } from "../../shared/search";

const BINARY =
  /\.(?:png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|7z|tar|exe|dll|so|dylib|node|bin|woff2?|ttf|mp[34]|mov|wav|sqlite|db|docx|xlsx|pptx)$/i;
const literal = (value: string) =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");

function symbolsInSource(
  file: string,
  content: string,
  query: string,
  limit: number,
): SymbolSearchResult[] {
  const symbols: SymbolSearchResult[] = [];
  const match = literal(query);
  const matches = (name: string) => {
    match.lastIndex = 0;
    return match.test(name);
  };
  if (/\.[cm]?[jt]sx?$/i.test(file)) {
    const source = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (symbols.length >= limit) return;
      let name: ts.Identifier | undefined,
        kind: SymbolSearchResult["kind"] | undefined;
      if (
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name
      ) {
        name = node.name;
        kind = ts.isClassDeclaration(node) ? "class" : "function";
      } else if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        name = node.name;
        kind = ts.isInterfaceDeclaration(node) ? "interface" : "type";
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        name = node.name;
        kind =
          node.initializer &&
          (ts.isArrowFunction(node.initializer) ||
            ts.isFunctionExpression(node.initializer))
            ? "function"
            : "variable";
      }
      if (name && kind && matches(name.text))
        symbols.push({
          path: file,
          name: name.text,
          kind,
          line:
            source.getLineAndCharacterOfPosition(name.getStart(source)).line +
            1,
          origin: "typescript-ast",
        });
      ts.forEachChild(node, visit);
    };
    visit(source);
  } else if (/\.py$/i.test(file)) {
    content.split(/\r?\n/).some((line, index) => {
      const declaration = line.match(
        /^\s*(?:async\s+)?(def|class)\s+([\p{ID_Start}_][\p{ID_Continue}]*)/u,
      );
      if (declaration && matches(declaration[2]))
        symbols.push({
          path: file,
          name: declaration[2],
          kind: declaration[1] === "class" ? "class" : "function",
          line: index + 1,
          origin: "python-pattern",
        });
      return symbols.length >= limit;
    });
  }
  return symbols;
}

/** Read-only, bounded search using the same ignore/path rules as the explorer. */
export async function searchRepository(
  root: string,
  rawQuery: string,
  options: {
    signal?: AbortSignal;
    byteBudget?: number;
    entryLimit?: number;
    resultLimit?: number;
  } = {},
): Promise<WorkspaceSearch> {
  if (typeof rawQuery !== "string")
    throw new Error("Search query must be text");
  const query = rawQuery.trim().slice(0, 256);
  const result: WorkspaceSearch = {
    query,
    text: [],
    symbols: [],
    scannedFiles: 0,
    eligibleFiles: 0,
    totalFiles: 0,
    truncated: false,
    warnings: [],
  };
  options.signal?.throwIfAborted();
  if (!query) return result;
  const limit = Math.max(1, Math.min(150, options.resultLimit || 150));
  const byteBudget = Math.max(
    1,
    Math.min(64_000_000, options.byteBudget || 64_000_000),
  );
  const listing = await listWorkspace(
    root,
    Math.min(20_000, options.entryLimit || 20_000),
  );
  options.signal?.throwIfAborted();
  result.truncated = listing.truncated;
  result.warnings.push(...listing.warnings.slice(0, 10));
  if (listing.truncated)
    result.warnings.push(
      "Project entry limit reached; narrow the project folder to search more files.",
    );
  const files = listing.entries.filter((entry) => entry.kind === "file");
  result.totalFiles = files.length;
  const eligible = files.filter(
    (file) => file.size <= TEXT_LIMIT && !BINARY.test(path.basename(file.path)),
  );
  result.eligibleFiles = eligible.length;
  const oversized = files.filter(
    (file) => file.size > TEXT_LIMIT && !BINARY.test(file.path),
  ).length;
  if (oversized) {
    result.truncated = true;
    result.warnings.push(
      `${oversized} text file(s) exceed the 1.5 MB per-file limit.`,
    );
  }
  let bytes = 0;
  const expression = literal(query);
  for (const file of eligible) {
    options.signal?.throwIfAborted();
    if (result.text.length >= limit && result.symbols.length >= limit) {
      result.truncated = true;
      break;
    }
    if (bytes + file.size > byteBudget) {
      result.truncated = true;
      result.warnings.push(
        "Search source-read budget reached (at most 64 MB).",
      );
      break;
    }
    let content: string;
    try {
      content = await readWorkspaceText(root, file.path);
    } catch (error) {
      result.truncated = true;
      if (result.warnings.length < 20)
        result.warnings.push(
          `${file.path}: ${error instanceof Error ? error.message : error}`,
        );
      continue;
    }
    options.signal?.throwIfAborted();
    bytes += Buffer.byteLength(content);
    if (bytes > byteBudget) {
      result.truncated = true;
      result.warnings.push("Search source-read budget reached.");
      break;
    }
    result.scannedFiles++;
    if (result.symbols.length < limit)
      result.symbols.push(
        ...symbolsInSource(
          file.path,
          content,
          query,
          limit - result.symbols.length,
        ),
      );
    if (result.text.length >= limit) continue;
    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
    for (
      let index = 0;
      index < lines.length && result.text.length < limit;
      index++
    ) {
      const line = lines[index];
      expression.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(line)) && result.text.length < limit) {
        const start = Math.max(0, match.index - 60),
          end = Math.min(line.length, match.index + match[0].length + 220);
        result.text.push({
          path: file.path,
          line: index + 1,
          column: match.index + 1,
          preview: `${start ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`,
        });
      }
    }
  }
  if (result.text.length >= limit || result.symbols.length >= limit) {
    result.truncated = true;
    result.warnings.push(
      `Showing at most ${limit} matches per section. Refine the search to see other matches.`,
    );
  }
  return result;
}
