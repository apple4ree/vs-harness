import path from "node:path";
import ts from "typescript";
import type {
  ArchitectureGraph,
  ArchitectureNode,
  ArchitectureEdge,
  CodeSymbol,
} from "../../shared/architecture";
import type { SemanticGraph } from "../../shared/semantic";
import { finalizeArchitectureGraph } from "../../shared/architecture-ir";
import {
  listWorkspace,
  contentHash,
  readWorkspaceText,
  TEXT_LIMIT,
} from "./workspace-files";
import { buildSemanticGraph } from "./semantic-analysis";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".vue",
  ".svelte",
  ".json",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
  ".md",
]);
type ImportRecord = {
  specifier: string;
  line: number;
  kind: "imports" | "exports";
};
export type ArchitectureCache = Map<
  string,
  { hash: string; symbols: CodeSymbol[]; imports: ImportRecord[] }
>;
export type AnalysisOptions = {
  cache?: ArchitectureCache;
  signal?: AbortSignal;
  byteBudget?: number;
  previousSemantic?: SemanticGraph | null;
};

export function moduleFor(file: string): string {
  const parts = file.split("/");
  if (parts.length === 1) return "root";
  if (["apps", "packages", "services"].includes(parts[0]) && parts.length > 2)
    return parts.slice(0, 2).join("/");
  if (["src", "lib"].includes(parts[0]) && parts.length > 2)
    return parts.slice(0, 2).join("/");
  return parts[0];
}

function tsSymbolsAndImports(file: string, content: string) {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const lineAt = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const exported = (node: ts.Node) =>
    Boolean(
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
  const hasJsx = (node: ts.Node): boolean =>
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    Boolean(ts.forEachChild(node, hasJsx));
  function symbol(
    node: ts.Node,
    name: string,
    kind: CodeSymbol["kind"],
    isExported: boolean,
    containerId?: string,
  ) {
    const line = lineAt(node);
    const id = `${file}#${name}:${line}`;
    const modifiers = ts.canHaveModifiers(node)
      ? ts.getModifiers(node) || []
      : [];
    const decorators = ts.canHaveDecorators(node)
      ? (ts.getDecorators(node) || []).map((item) => item.getText(source))
      : [];
    const container = containerId
      ? symbols.find((item) => item.id === containerId)
      : null;
    symbols.push({
      id,
      name,
      kind,
      line,
      endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      exported: isExported,
      qualifiedName: container
        ? `${container.qualifiedName || container.name}.${name}`
        : name,
      containerId,
      async: modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ),
      decorators,
      signature: node.getText(source).split("{")[0].trim().slice(0, 500),
      visibility: modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
      )
        ? "private"
        : modifiers.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ProtectedKeyword,
            )
          ? "protected"
          : "public",
    });
    return id;
  }
  function visit(node: ts.Node, containerId?: string) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push({
        specifier: node.moduleSpecifier.text,
        line: lineAt(node),
        kind: "imports",
      });
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push({
        specifier: node.moduleSpecifier.text,
        line: lineAt(node),
        kind: "exports",
      });
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      imports.push({
        specifier: node.moduleReference.expression.text,
        line: lineAt(node),
        kind: "imports",
      });
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push({
        specifier: node.arguments[0].text,
        line: lineAt(node),
        kind: "imports",
      });
    let childContainer = containerId;
    if (ts.isFunctionDeclaration(node) && node.name)
      childContainer = symbol(
        node,
        node.name.text,
        hasJsx(node) ? "component" : "function",
        exported(node),
        containerId,
      );
    if (ts.isClassDeclaration(node) && node.name)
      childContainer = symbol(
        node,
        node.name.text,
        "class",
        exported(node),
        containerId,
      );
    if (ts.isInterfaceDeclaration(node))
      childContainer = symbol(
        node,
        node.name.text,
        "interface",
        exported(node),
        containerId,
      );
    if (ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node))
      symbol(node, node.name.text, "type", exported(node), containerId);
    if (
      (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) &&
      node.name
    )
      childContainer = symbol(
        node,
        node.name.getText(source),
        "method",
        true,
        containerId,
      );
    if (ts.isVariableStatement(node) && node.parent === source) {
      for (const declaration of node.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) {
          const init = declaration.initializer;
          const id = symbol(
            declaration,
            declaration.name.text,
            init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
              ? hasJsx(init)
                ? "component"
                : "function"
              : "variable",
            exported(node),
            containerId,
          );
          if (
            init &&
            (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          )
            childContainer = id;
        }
    }
    ts.forEachChild(node, (child) => visit(child, childContainer));
  }
  visit(source);
  return { symbols, imports };
}

function pythonSymbolsAndImports(file: string, content: string) {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const lines = content.split(/\r?\n/);
  const stack: Array<{ indent: number; symbol: CodeSymbol }> = [];
  let decorators: Array<{ indent: number; text: string }> = [];
  const indentation = (text: string) =>
    (text.match(/^\s*/)?.[0] || "").replaceAll("\t", "    ").length;
  lines.forEach((text, index) => {
    const trimmed = text.trim();
    const indent = indentation(text);
    if (trimmed && !trimmed.startsWith("#")) {
      while (stack.length && indent <= stack.at(-1)!.indent) {
        stack.at(-1)!.symbol.endLine = Math.max(
          stack.at(-1)!.symbol.line,
          index,
        );
        stack.pop();
      }
    }
    const decorator = text.match(/^\s*@(.+)/);
    if (decorator) {
      decorators = decorators.filter((item) => item.indent === indent);
      decorators.push({ indent, text: decorator[1].trim().slice(0, 300) });
    }
    const definition = text.match(
      /^\s*(async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*(.*)$/,
    );
    if (definition) {
      const container = [...stack]
        .reverse()
        .find(
          (item) => item.indent < indent && item.symbol.kind === "class",
        )?.symbol;
      const kind: CodeSymbol["kind"] =
        definition[2] === "class" ? "class" : container ? "method" : "function";
      const symbol: CodeSymbol = {
        id: `${file}#${definition[3]}:${index + 1}`,
        name: definition[3],
        kind,
        line: index + 1,
        endLine: index + 1,
        exported: !definition[3].startsWith("_"),
        qualifiedName: container
          ? `${container.qualifiedName || container.name}.${definition[3]}`
          : definition[3],
        containerId: container?.id,
        async: Boolean(definition[1]),
        decorators: decorators
          .filter((item) => item.indent === indent)
          .map((item) => item.text),
        signature: trimmed.slice(0, 500),
        visibility: definition[3].startsWith("_") ? "private" : "public",
      };
      symbols.push(symbol);
      stack.push({ indent, symbol });
      decorators = [];
    } else if (trimmed && !decorator && !trimmed.startsWith("#")) {
      decorators = [];
    }
    const from = text.match(/^\s*from\s+([.\w]+)\s+import\s+/);
    if (from)
      imports.push({ specifier: from[1], line: index + 1, kind: "imports" });
    else {
      const imported = text.match(
        /^\s*import\s+([\w.,\s]+?)(?:\s+as\s+\w+)?\s*(?:#.*)?$/,
      );
      if (imported)
        imported[1].split(",").forEach((name) =>
          imports.push({
            specifier: name.trim(),
            line: index + 1,
            kind: "imports",
          }),
        );
    }
  });
  while (stack.length) {
    stack.at(-1)!.symbol.endLine = Math.max(
      stack.at(-1)!.symbol.line,
      lines.length,
    );
    stack.pop();
  }
  return { symbols, imports };
}

function rustSymbolsAndImports(file: string, content: string) {
  const symbols: CodeSymbol[] = [];
  const imports: ImportRecord[] = [];
  const lines = content.split(/\r?\n/);
  let depth = 0;
  let attributes: string[] = [];
  const active: Array<{
    depth: number;
    symbol: CodeSymbol;
    body: boolean;
  }> = [];
  const closeFinished = (line: number) => {
    while (
      active.length &&
      (!active.at(-1)!.body || depth <= active.at(-1)!.depth)
    ) {
      active.at(-1)!.symbol.endLine = Math.max(
        active.at(-1)!.symbol.line,
        line,
      );
      active.pop();
    }
  };
  lines.forEach((text, index) => {
    const line = index + 1;
    const trimmed = text.trim();
    const attribute = trimmed.match(/^#!?\[(.+)\]$/);
    if (attribute) attributes.push(attribute[1].slice(0, 300));

    const imported = trimmed.match(/^(pub\s+)?use\s+([^;]+);/);
    if (imported) {
      const specifier = imported[2]
        .replace(/^::/, "")
        .replace(/\{.*$/, "")
        .replace(/::$/, "")
        .trim();
      if (specifier)
        imports.push({
          specifier,
          line,
          kind: imported[1] ? "exports" : "imports",
        });
    }
    const moduleDeclaration = trimmed.match(
      /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/,
    );
    if (moduleDeclaration)
      imports.push({
        specifier: `self::${moduleDeclaration[1]}`,
        line,
        kind: "imports",
      });

    const definition = trimmed.match(
      /^(pub(?:\([^)]*\))?\s+)?(?:(async)\s+)?(fn|struct|enum|trait|type|mod)\s+([A-Za-z_]\w*)/,
    );
    const implementation = trimmed.match(
      /^impl(?:<[^>]*>)?\s+([^\{]+?)(?:\s+where\s+[^\{]+)?\s*\{/,
    );
    const container = [...active]
      .reverse()
      .find((item) =>
        ["implementation", "trait"].includes(item.symbol.kind),
      )?.symbol;
    let symbol: CodeSymbol | null = null;
    if (definition) {
      const rawKind = definition[3];
      const kind: CodeSymbol["kind"] =
        rawKind === "fn"
          ? container
            ? "method"
            : "function"
          : rawKind === "struct"
            ? "struct"
            : rawKind === "enum"
              ? "enum"
              : rawKind === "trait"
                ? "trait"
                : rawKind === "mod"
                  ? "module"
                  : "type";
      symbol = {
        id: `${file}#${definition[4]}:${line}`,
        name: definition[4],
        kind,
        line,
        endLine: line,
        exported: Boolean(definition[1]),
        qualifiedName: container
          ? `${container.qualifiedName || container.name}::${definition[4]}`
          : definition[4],
        containerId: container?.id,
        async: Boolean(definition[2]),
        decorators: attributes,
        signature: trimmed.split("{")[0].trim().slice(0, 500),
        visibility: definition[1] ? "public" : "private",
      };
    } else if (implementation) {
      const name = `impl ${implementation[1].trim()}`;
      symbol = {
        id: `${file}#${name}:${line}`,
        name,
        kind: "implementation",
        line,
        endLine: line,
        exported: false,
        qualifiedName: name,
        decorators: attributes,
        signature: trimmed.split("{")[0].trim().slice(0, 500),
        visibility: "internal",
      };
    }
    if (symbol) {
      symbols.push(symbol);
      const opens = (text.match(/\{/g) || []).length;
      const closes = (text.match(/\}/g) || []).length;
      active.push({ depth, symbol, body: opens > closes });
      attributes = [];
    } else if (trimmed && !attribute && !trimmed.startsWith("//")) {
      attributes = [];
    }

    depth += (text.match(/\{/g) || []).length;
    depth -= (text.match(/\}/g) || []).length;
    closeFinished(line);
  });
  depth = -1;
  closeFinished(lines.length);
  return { symbols, imports };
}

export async function analyzeRepository(
  root: string,
  options: AnalysisOptions = {},
): Promise<ArchitectureGraph> {
  options.signal?.throwIfAborted();
  const listing = await listWorkspace(root);
  const files = listing.entries.filter((entry) => entry.kind === "file");
  const sourceFiles = files.filter(
    (entry) =>
      SOURCE_EXTENSIONS.has(entry.extension) && entry.size <= TEXT_LIMIT,
  );
  const nodes: ArchitectureNode[] = [];
  const edges: ArchitectureEdge[] = [];
  const imports = new Map<string, ImportRecord[]>();
  const fileSet = new Map(
    files.map((file) => [path.resolve(root, file.path), file.path]),
  );
  const foldedFiles = new Map<string, string | null>();
  for (const [absolute, relative] of fileSet) {
    const key = absolute.toLowerCase();
    foldedFiles.set(key, foldedFiles.has(key) ? null : relative);
  }
  function findFile(candidate: string) {
    const absolute = path.resolve(candidate);
    // Prefer exact names on case-sensitive volumes; only fold when the actual OS accepts the path.
    return (
      fileSet.get(absolute) ||
      (ts.sys.fileExists(absolute)
        ? foldedFiles.get(absolute.toLowerCase())
        : null)
    );
  }
  const warnings = [...listing.warnings];
  const contents = new Map<string, string[]>();
  let authoredContent: string | null = null;
  let bytesRead = 0;
  let budgetReached = false;
  const activeFiles = new Set(sourceFiles.map((file) => file.path));
  for (const key of options.cache?.keys() || [])
    if (!activeFiles.has(key)) options.cache?.delete(key);
  for (const file of sourceFiles) {
    options.signal?.throwIfAborted();
    if (bytesRead + file.size > (options.byteBudget ?? 64_000_000)) {
      budgetReached = true;
      break;
    }
    let content: string;
    try {
      content = await readWorkspaceText(root, file.path);
    } catch (error) {
      warnings.push(
        `${file.path}: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }
    const hash = contentHash(content);
    if (file.path.replaceAll("\\", "/") === ".witch/analysis.json")
      authoredContent = content;
    bytesRead += Buffer.byteLength(content);
    const cached = options.cache?.get(file.path);
    const parsed =
      cached?.hash === hash
        ? cached
        : /\.[cm]?[jt]sx?$/i.test(file.path)
          ? tsSymbolsAndImports(file.path, content)
          : file.extension === ".py"
            ? pythonSymbolsAndImports(file.path, content)
            : file.extension === ".rs"
              ? rustSymbolsAndImports(file.path, content)
              : { symbols: [], imports: [] };
    options.cache?.set(file.path, { hash, ...parsed });
    nodes.push({
      id: file.path,
      label: path.basename(file.path),
      kind: "file",
      path: file.path,
      module: moduleFor(file.path),
      language: file.extension.slice(1),
      hash,
      count: 1,
      symbols: parsed.symbols,
      evidence: [{ path: file.path, line: 1, hash }],
    });
    imports.set(file.path, parsed.imports);
    contents.set(
      file.path,
      parsed.imports.length ? content.split(/\r?\n/) : [],
    );
  }
  if (budgetReached)
    warnings.push(
      `Source analysis reached its ${(options.byteBudget ?? 64_000_000) / 1_000_000} MB safety budget. Open a narrower project to include the remaining sources.`,
    );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const optionsCache = new Map<string, ts.CompilerOptions>();
  const directoryOptions = new Map<string, ts.CompilerOptions>();
  const resolutionCaches = new Map<
    ts.CompilerOptions,
    ts.ModuleResolutionCache
  >();
  function compilerOptions(file: string) {
    const directory = path.dirname(path.join(root, file));
    if (directoryOptions.has(directory))
      return directoryOptions.get(directory)!;
    const configPath =
      ts.findConfigFile(
        directory,
        (candidate) => {
          const relative = path.relative(root, candidate);
          return !relative.startsWith("..") && ts.sys.fileExists(candidate);
        },
        "tsconfig.json",
      ) || ts.findConfigFile(directory, ts.sys.fileExists, "jsconfig.json");
    const key = configPath || root;
    if (!optionsCache.has(key)) {
      let options: ts.CompilerOptions = {
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
      };
      if (configPath && !path.relative(root, configPath).startsWith("..")) {
        const config = ts.readConfigFile(configPath, ts.sys.readFile);
        if (!config.error)
          options = {
            ...options,
            ...ts.parseJsonConfigFileContent(
              config.config,
              ts.sys,
              path.dirname(configPath),
            ).options,
          };
      }
      optionsCache.set(key, options);
    }
    const options = optionsCache.get(key)!;
    directoryOptions.set(directory, options);
    return options;
  }
  function resolveImport(file: string, specifier: string): string | null {
    const spec = specifier.split("?")[0];
    if (file.endsWith(".py")) {
      const dots = spec.match(/^\.+/)?.[0].length || 0;
      const base = dots
        ? path.resolve(
            path.dirname(path.join(root, file)),
            ...Array(Math.max(0, dots - 1)).fill(".."),
            spec.slice(dots).replaceAll(".", "/"),
          )
        : path.join(root, spec.replaceAll(".", "/"));
      for (const candidate of [base + ".py", path.join(base, "__init__.py")]) {
        const found = findFile(candidate);
        if (found && nodeIds.has(found)) return found;
      }
      return dots ? null : `external:${spec.split(".")[0]}`;
    }
    if (file.endsWith(".rs")) {
      const parts = spec
        .replace(/\s+as\s+\w+$/, "")
        .split("::")
        .filter(Boolean);
      const first = parts[0];
      if (!first) return null;
      let base: string;
      let moduleParts: string[];
      if (first === "crate") {
        base = path.join(root, "src");
        moduleParts = parts.slice(1);
      } else if (first === "self") {
        base = path.dirname(path.join(root, file));
        moduleParts = parts.slice(1);
      } else if (first === "super") {
        let levels = 0;
        while (parts[levels] === "super") levels++;
        base = path.resolve(
          path.dirname(path.join(root, file)),
          ...Array(levels).fill(".."),
        );
        moduleParts = parts.slice(levels);
      } else {
        return `external:${first}`;
      }
      for (let length = moduleParts.length; length > 0; length--) {
        const candidate = path.join(base, ...moduleParts.slice(0, length));
        for (const target of [
          candidate + ".rs",
          path.join(candidate, "mod.rs"),
        ]) {
          const found = findFile(target);
          if (found && nodeIds.has(found)) return found;
        }
      }
      return null;
    }
    const compiler = compilerOptions(file);
    if (!resolutionCaches.has(compiler))
      resolutionCaches.set(
        compiler,
        ts.createModuleResolutionCache(
          root,
          (file) =>
            ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(),
          compiler,
        ),
      );
    const resolved = ts.resolveModuleName(
      spec,
      path.join(root, file),
      compiler,
      ts.sys,
      resolutionCaches.get(compiler),
    ).resolvedModule;
    if (resolved) {
      const found = findFile(resolved.resolvedFileName);
      if (found && nodeIds.has(found)) return found;
    }
    if (spec.startsWith(".")) {
      const base = path.resolve(root, path.dirname(file), spec);
      const candidates = [
        base,
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".json",
          ".css",
          ".vue",
          ".svelte",
        ].flatMap((extension) => [
          base + extension,
          path.join(base, `index${extension}`),
        ]),
      ];
      for (const candidate of candidates) {
        const found = findFile(candidate);
        if (found && nodeIds.has(found)) return found;
      }
      return null;
    }
    return `external:${spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]}`;
  }
  const edgeIndex = new Map<string, ArchitectureEdge>();
  let processed = 0;
  for (const node of [...nodes]) {
    if (++processed % 64 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    options.signal?.throwIfAborted();
    for (const imported of imports.get(node.id) || []) {
      const target = resolveImport(node.id, imported.specifier);
      if (!target) {
        warnings.push(
          `Unresolved import ${imported.specifier} in ${node.id}:${imported.line}`,
        );
        continue;
      }
      if (target.startsWith("external:") && !nodeIds.has(target)) {
        nodes.push({
          id: target,
          label: target.slice(9),
          kind: "external",
          module: "external",
          language: "package",
          count: 1,
          hash: "",
          symbols: [],
          evidence: [],
        });
        nodeIds.add(target);
      }
      const key = `${node.id}:${imported.kind}:${target}`;
      const evidence = {
        path: node.id,
        line: imported.line,
        hash: node.hash,
        excerpt: contents
          .get(node.id)
          ?.[imported.line - 1]?.trim()
          .slice(0, 300),
      };
      const existing = edgeIndex.get(key);
      if (existing) {
        existing.count++;
        existing.evidence.push(evidence);
      } else {
        const edge: ArchitectureEdge = {
          id: key,
          from: node.id,
          to: target,
          kind: imported.kind,
          count: 1,
          evidence: [evidence],
        };
        edges.push(edge);
        edgeIndex.set(key, edge);
      }
    }
  }
  const revision = contentHash(
    nodes
      .filter((node) => node.path)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => `${node.id}:${node.hash}`)
      .join("\n"),
  );
  const generatedAt = new Date().toISOString();
  const semantic = buildSemanticGraph({
    workspaceRoot: root,
    sourceRevision: revision,
    generatedAt,
    nodes,
    edges,
    previous: options.previousSemantic,
    authoredContent,
  });
  warnings.push(...semantic.warnings);
  return finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "polyglot-static-v3",
    workspaceRoot: root,
    revision,
    generatedAt,
    nodes,
    edges,
    scannedFiles: contents.size,
    totalFiles: files.length,
    truncated: listing.truncated || budgetReached,
    warnings: warnings.slice(0, 100),
    semantic: semantic.graph,
  });
}
