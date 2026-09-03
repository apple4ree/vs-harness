import path from "node:path";
import ts from "typescript";
import type {
  AnalysisCoverage,
  AnalysisLanguageCoverage,
  AnalysisLimit,
  ArchitectureGraph,
  ArchitectureNode,
  ArchitectureEdge,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type { SemanticGraph } from "../../shared/semantic";
import { finalizeArchitectureGraph } from "../../shared/architecture-ir";
import {
  listWorkspace,
  contentHash,
  readWorkspaceText,
  TEXT_LIMIT,
} from "./workspace-files";
import {
  buildSemanticGraph,
  type ResolvedSymbolCall,
  type ResolvedSymbolRelation,
  type SymbolCallCorroboration,
} from "./semantic-analysis";
import type { CallCorroborator } from "./call-corroboration";
import {
  pythonResolvedCalls,
  rustResolvedCalls,
} from "./polyglot-call-analysis";
import {
  pythonResolvedTypeRelations,
  rustResolvedTypeRelations,
} from "./polyglot-type-analysis";
import { buildBehaviorGraph } from "./behavior-analysis";
import { analyzeFrameworks } from "./framework-analysis";
import {
  analyzeArchitectureKnowledge,
  isArchitectureKnowledgePath,
} from "./knowledge-analysis";

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
  ".toml",
  ".ini",
]);
const DEEP_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
]);
export const ARCHITECTURE_ANALYZER_VERSION = "polyglot-static-v19";

function coverageLanguage(extension: string) {
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  const names: Record<string, string> = {
    ".py": "python",
    ".rs": "rust",
    ".java": "java",
    ".go": "go",
    ".swift": "swift",
    ".kt": "kotlin",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "header",
    ".rb": "ruby",
    ".php": "php",
    ".vue": "vue",
    ".svelte": "svelte",
    ".json": "json",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".md": "markdown",
    ".toml": "toml",
    ".ini": "ini",
  };
  return names[extension] || extension.replace(/^\./, "") || "unknown";
}
type ImportRecord = {
  specifier: string;
  line: number;
  kind: "imports" | "exports";
};
export type ParsedSource = {
  symbols: CodeSymbol[];
  imports: ImportRecord[];
  hasCallExpressions?: boolean;
  symbolIdCollisions?: number;
};
export type ArchitectureCacheEntry = ParsedSource & {
  hash: string;
  size?: number;
  mtimeMs?: number;
  /** Kept in memory only so watcher-triggered readings touch changed files. */
  content?: string;
  /** Runtime marker set by the durable index loader and never persisted. */
  persistent?: boolean;
};
export type ArchitectureCache = Map<string, ArchitectureCacheEntry>;
export type AnalysisOptions = {
  cache?: ArchitectureCache;
  signal?: AbortSignal;
  byteBudget?: number;
  previousSemantic?: SemanticGraph | null;
  callCorroborator?: CallCorroborator;
  invalidatedPaths?: ReadonlySet<string>;
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
  const usedSymbolIds = new Set<string>();
  const declarationSymbols = new Map<ts.Node, string>();
  let symbolIdCollisions = 0;
  let hasCallExpressions = false;
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
    const startOffset = node.getStart(source);
    const location = source.getLineAndCharacterOfPosition(startOffset);
    const line = location.line + 1;
    const baseId = `${file}#${name}:${line}`;
    let id = baseId;
    if (usedSymbolIds.has(id)) {
      symbolIdCollisions++;
      id = `${baseId}@${startOffset}`;
      let ordinal = 2;
      while (usedSymbolIds.has(id))
        id = `${baseId}@${startOffset}.${ordinal++}`;
    }
    usedSymbolIds.add(id);
    declarationSymbols.set(node, id);
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
      column: location.character + 1,
      startOffset,
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
    if (ts.isCallExpression(node)) hasCallExpressions = true;
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
    if (ts.isClassExpression(node)) {
      const declaration = ts.isVariableDeclaration(node.parent)
        ? node.parent
        : null;
      const existing = declaration
        ? declarationSymbols.get(declaration)
        : undefined;
      if (existing) childContainer = existing;
      else {
        const propertyName = ts.isPropertyAssignment(node.parent)
          ? node.parent.name.getText(source)
          : null;
        const name =
          (declaration && ts.isIdentifier(declaration.name)
            ? declaration.name.text
            : null) ||
          node.name?.text ||
          propertyName ||
          `class@${lineAt(node)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).character + 1}`;
        childContainer = symbol(node, name, "class", false, containerId);
      }
    }
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isVariableDeclaration(node.parent)
    ) {
      const existing = declarationSymbols.get(node.parent);
      if (existing) childContainer = existing;
    }
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
            init && ts.isClassExpression(init)
              ? "class"
              : init &&
                  (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
                ? hasJsx(init)
                  ? "component"
                  : "function"
                : "variable",
            exported(node),
            containerId,
          );
          declarationSymbols.set(declaration, id);
        }
    }
    ts.forEachChild(node, (child) => visit(child, childContainer));
  }
  visit(source);
  return { symbols, imports, hasCallExpressions, symbolIdCollisions };
}

const typeScriptExtension = (file: string): ts.Extension => {
  const normalized = file.toLowerCase();
  if (normalized.endsWith(".d.ts")) return ts.Extension.Dts;
  if (normalized.endsWith(".tsx")) return ts.Extension.Tsx;
  if (normalized.endsWith(".mts")) return ts.Extension.Mts;
  if (normalized.endsWith(".cts")) return ts.Extension.Cts;
  if (normalized.endsWith(".jsx")) return ts.Extension.Jsx;
  if (normalized.endsWith(".mjs")) return ts.Extension.Mjs;
  if (normalized.endsWith(".cjs")) return ts.Extension.Cjs;
  if (normalized.endsWith(".js")) return ts.Extension.Js;
  return ts.Extension.Ts;
};

async function typeScriptResolvedFacts(
  root: string,
  sourceNodes: ArchitectureNode[],
  sourceTexts: Map<string, string>,
  resolveImport: (file: string, specifier: string) => string | null,
  signal?: AbortSignal,
): Promise<{
  calls: ResolvedSymbolCall[];
  relations: ResolvedSymbolRelation[];
}> {
  if (!sourceTexts.size) return { calls: [], relations: [] };
  const canonical = (file: string) => {
    const absolute = path.resolve(file);
    return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
  };
  const records = new Map<
    string,
    { relative: string; absolute: string; text: string; node: ArchitectureNode }
  >();
  const nodes = new Map(sourceNodes.map((node) => [node.id, node]));
  for (const [relative, text] of sourceTexts) {
    const node = nodes.get(relative);
    if (!node) continue;
    const absolute = path.resolve(root, relative);
    records.set(canonical(absolute), { relative, absolute, text, node });
  }
  const scriptKindFor = (relative: string) => {
    const extension = typeScriptExtension(relative);
    if (extension === ts.Extension.Tsx) return ts.ScriptKind.TSX;
    if (extension === ts.Extension.Jsx) return ts.ScriptKind.JSX;
    if (
      [ts.Extension.Js, ts.Extension.Mjs, ts.Extension.Cjs].includes(extension)
    )
      return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
  };
  // TypeScript follows imported source files synchronously while building a
  // Program. A long import chain can therefore leave every parser frame on
  // the JavaScript stack. Parse each source independently first and order
  // roots dependency-first so Program construction reuses already-seen files.
  const parsedSources = new Map<string, ts.SourceFile>();
  for (const [index, [key, record]] of [...records].entries()) {
    signal?.throwIfAborted();
    if (index > 0 && index % 64 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    parsedSources.set(
      key,
      ts.createSourceFile(
        record.absolute,
        record.text,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(record.relative),
      ),
    );
  }
  const dependencyCount = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const [key, record] of records) {
    const dependencies = new Set<string>();
    for (const imported of ts.preProcessFile(record.text, true, true)
      .importedFiles) {
      const target = resolveImport(record.relative, imported.fileName);
      if (!target || target.startsWith("external:")) continue;
      const targetKey = canonical(path.resolve(root, target));
      if (targetKey !== key && records.has(targetKey))
        dependencies.add(targetKey);
    }
    dependencyCount.set(key, dependencies.size);
    for (const dependency of dependencies) {
      const current = dependents.get(dependency) || new Set<string>();
      current.add(key);
      dependents.set(dependency, current);
    }
  }
  const ready = [...records.keys()]
    .filter((key) => dependencyCount.get(key) === 0)
    .sort();
  const orderedKeys: string[] = [];
  for (let index = 0; index < ready.length; index++) {
    const key = ready[index];
    orderedKeys.push(key);
    for (const dependent of [...(dependents.get(key) || [])].sort()) {
      const remaining = (dependencyCount.get(dependent) || 0) - 1;
      dependencyCount.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }
  if (orderedKeys.length < records.size) {
    const ordered = new Set(orderedKeys);
    orderedKeys.push(
      ...[...records.keys()].filter((key) => !ordered.has(key)).sort(),
    );
  }
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const fallback = ts.createCompilerHost(compilerOptions, true);
  const recordFor = (file: string) => records.get(canonical(file));
  const host: ts.CompilerHost = {
    ...fallback,
    fileExists: (file) => Boolean(recordFor(file)),
    readFile: (file) => recordFor(file)?.text,
    getCurrentDirectory: () => root,
    getSourceFile: (file) => parsedSources.get(canonical(file)),
    resolveModuleNames: (moduleNames, containingFile) => {
      const containing = recordFor(containingFile);
      return moduleNames.map((specifier) => {
        if (!containing) return undefined;
        const target = resolveImport(containing.relative, specifier);
        if (!target || target.startsWith("external:")) return undefined;
        const record = records.get(canonical(path.resolve(root, target)));
        return record
          ? {
              resolvedFileName: record.absolute,
              extension: typeScriptExtension(record.relative),
              isExternalLibraryImport: false,
            }
          : undefined;
      });
    },
  };
  const program = ts.createProgram({
    rootNames: orderedKeys.map((key) => records.get(key)!.absolute),
    options: compilerOptions,
    host,
  });
  const checker = program.getTypeChecker();
  const symbolForDeclaration = (declaration: ts.Node): CodeSymbol | null => {
    let owner: ts.Node = declaration;
    if (
      (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) &&
      ts.isVariableDeclaration(owner.parent)
    )
      owner = owner.parent;
    if (ts.isClassExpression(owner) && ts.isVariableDeclaration(owner.parent))
      owner = owner.parent;
    const source = owner.getSourceFile();
    const record = recordFor(source.fileName);
    if (!record) return null;
    let name: string | null = null;
    if (ts.isFunctionDeclaration(owner) && owner.name) name = owner.name.text;
    else if (ts.isClassDeclaration(owner) && owner.name) name = owner.name.text;
    else if (ts.isInterfaceDeclaration(owner)) name = owner.name.text;
    else if (ts.isMethodDeclaration(owner) && owner.name)
      name = owner.name.getText(source);
    else if (ts.isMethodSignature(owner) && owner.name)
      name = owner.name.getText(source);
    else if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name))
      name = owner.name.text;
    if (!name) return null;
    const line =
      source.getLineAndCharacterOfPosition(owner.getStart(source)).line + 1;
    return (
      record.node.symbols.find(
        (symbol) => symbol.startOffset === owner.getStart(source),
      ) ||
      record.node.symbols.find(
        (symbol) => symbol.name === name && symbol.line === line,
      ) ||
      null
    );
  };
  const ownerFor = (descendant: ts.Node) => {
    let owner: ts.Node | undefined = descendant.parent;
    while (owner && !ts.isSourceFile(owner)) {
      if (
        ts.isFunctionDeclaration(owner) ||
        ts.isMethodDeclaration(owner) ||
        ts.isArrowFunction(owner) ||
        ts.isFunctionExpression(owner)
      )
        return symbolForDeclaration(owner);
      owner = owner.parent;
    }
    return null;
  };
  const targetFor = (call: ts.CallExpression) => {
    // Property bindings are accepted only when TypeScript resolves them to one
    // concrete source declaration. They remain inferred because runtime
    // overrides or JavaScript mutation can still replace the implementation.
    if (
      !ts.isIdentifier(call.expression) &&
      !ts.isPropertyAccessExpression(call.expression) &&
      !ts.isElementAccessExpression(call.expression)
    )
      return null;
    return callableTargetForNode(call.expression);
  };
  const targetForNode = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    for (const declaration of [
      symbol?.valueDeclaration,
      ...(symbol?.declarations || []),
    ]) {
      if (!declaration) continue;
      const target = symbolForDeclaration(declaration);
      if (target) return target;
    }
    return null;
  };
  const callableTargetForNode = (
    node: ts.Node,
    seen = new Set<ts.Symbol>(),
  ): CodeSymbol | null => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    for (const declaration of [
      symbol.valueDeclaration,
      ...(symbol.declarations || []),
    ]) {
      if (!declaration) continue;
      if (ts.isVariableDeclaration(declaration)) {
        if (
          !ts.isVariableDeclarationList(declaration.parent) ||
          !(declaration.parent.flags & ts.NodeFlags.Const)
        )
          continue;
        if (declaration.initializer) {
          const aliased = callableTargetForNode(declaration.initializer, seen);
          if (aliased) return aliased;
        }
      }
      const target = symbolForDeclaration(declaration);
      if (target && ["function", "method", "component"].includes(target.kind))
        return target;
    }
    return null;
  };
  type TypeScriptCallableReference =
    | { kind: "symbol"; symbol: CodeSymbol }
    | { kind: "parameter"; owner: CodeSymbol; name: string };
  type TypeScriptInvocation = {
    owner?: CodeSymbol;
    callee: TypeScriptCallableReference;
    arguments: Array<TypeScriptCallableReference | null>;
    evidence: SourceEvidence;
    ordinal: number;
  };
  const calls = new Map<string, ResolvedSymbolCall>();
  const relations = new Map<string, ResolvedSymbolRelation>();
  const parameters = new Map<string, string[]>();
  const invocations: TypeScriptInvocation[] = [];
  const addCallFact = (
    from: CodeSymbol,
    to: CodeSymbol,
    item: SourceEvidence,
    ordinal: number,
    trust: ResolvedSymbolCall["trust"],
    confidence: number,
  ) => {
    if (from.id === to.id || calls.size >= 10_000) return;
    const key = `${from.id}->${to.id}`;
    const existing = calls.get(key);
    if (existing) {
      if (
        existing.evidence.length < 20 &&
        !existing.evidence.some(
          (candidate) =>
            candidate.path === item.path && candidate.line === item.line,
        )
      )
        existing.evidence.push(item);
      if ((existing.sites?.length || 0) < 40)
        existing.sites!.push({ evidence: item, ordinal });
      if (existing.trust !== "verified" && trust === "verified") {
        existing.trust = "verified";
        existing.confidence = 1;
      } else if (existing.trust !== "verified")
        existing.confidence = Math.min(
          existing.confidence || confidence,
          confidence,
        );
      return;
    }
    calls.set(key, {
      fromSourceSymbolId: from.id,
      toSourceSymbolId: to.id,
      evidence: [item],
      trust,
      confidence,
      resolver: "typescript",
      sites: [{ evidence: item, ordinal }],
    });
  };
  const parameterReference = (
    node: ts.Node,
  ): TypeScriptCallableReference | null => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = (symbol?.declarations || []).find(ts.isParameter);
    if (!declaration || !ts.isIdentifier(declaration.name)) return null;
    const owner = symbolForDeclaration(declaration.parent);
    return owner
      ? { kind: "parameter", owner, name: declaration.name.text }
      : null;
  };
  const addRelation = (
    from: CodeSymbol | null,
    to: CodeSymbol | null,
    kind: ResolvedSymbolRelation["kind"],
    source: ts.SourceFile,
    record: { relative: string; text: string; node: ArchitectureNode },
    evidenceNode: ts.Node,
  ) => {
    if (!from || !to || from.id === to.id || relations.size >= 30_000) return;
    const key = `${kind}:${from.id}->${to.id}`;
    const line =
      source.getLineAndCharacterOfPosition(evidenceNode.getStart(source)).line +
      1;
    const item = {
      path: record.relative,
      line,
      hash: record.node.hash,
      excerpt: record.text.split(/\r?\n/)[line - 1]?.trim().slice(0, 300),
    };
    const existing = relations.get(key);
    if (existing) {
      if (
        existing.evidence.length < 20 &&
        !existing.evidence.some(
          (candidate) =>
            candidate.path === item.path && candidate.line === item.line,
        )
      )
        existing.evidence.push(item);
      return;
    }
    relations.set(key, {
      fromSourceSymbolId: from.id,
      toSourceSymbolId: to.id,
      kind,
      evidence: [item],
      trust: "verified",
      confidence: 1,
      resolver: "typescript",
    });
  };
  for (const [index, source] of program.getSourceFiles().entries()) {
    signal?.throwIfAborted();
    if (index > 0 && index % 16 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const record = recordFor(source.fileName);
    if (!record) continue;
    const lines = record.text.split(/\r?\n/);
    const moduleVariableNames = new Set(
      record.node.symbols
        .filter((symbol) => symbol.kind === "variable" && !symbol.containerId)
        .map((symbol) => symbol.name),
    );
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.importClause?.namedBindings
      )
        continue;
      const target = resolveImport(
        record.relative,
        statement.moduleSpecifier.text,
      );
      if (!target || target.startsWith("external:")) continue;
      const targetRecord = records.get(canonical(path.resolve(root, target)));
      if (!targetRecord) continue;
      const targetVariables = new Set(
        targetRecord.node.symbols
          .filter((symbol) => symbol.kind === "variable" && !symbol.containerId)
          .map((symbol) => symbol.name),
      );
      const bindings = statement.importClause.namedBindings;
      if (ts.isNamespaceImport(bindings))
        targetVariables.forEach((name) => moduleVariableNames.add(name));
      else
        for (const binding of bindings.elements) {
          const imported = binding.propertyName?.text || binding.name.text;
          if (targetVariables.has(imported))
            moduleVariableNames.add(binding.name.text);
        }
    }
    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        const owner = symbolForDeclaration(node);
        if (owner)
          parameters.set(
            owner.id,
            node.parameters.flatMap((parameter) =>
              ts.isIdentifier(parameter.name) ? [parameter.name.text] : [],
            ),
          );
      }
      if (ts.isCallExpression(node) && calls.size < 10_000) {
        const from = ownerFor(node);
        const to = targetFor(node);
        const callee: TypeScriptCallableReference | null = to
          ? { kind: "symbol", symbol: to }
          : parameterReference(node.expression);
        if (callee) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1;
          const evidence: SourceEvidence = {
            path: record.relative,
            line,
            hash: record.node.hash,
            excerpt: lines[line - 1]?.trim().slice(0, 300),
          };
          invocations.push({
            ...(from ? { owner: from } : {}),
            callee,
            arguments: node.arguments.map((argument) => {
              const target = callableTargetForNode(argument);
              if (target)
                return {
                  kind: "symbol" as const,
                  symbol: target,
                };
              const parameter = parameterReference(argument);
              return parameter || null;
            }),
            evidence,
            ordinal: node.getStart(source),
          });
          if (from && to)
            addCallFact(
              from,
              to,
              evidence,
              node.getStart(source),
              ts.isIdentifier(node.expression) ? "verified" : "inferred",
              ts.isIdentifier(node.expression) ? 1 : 0.9,
            );
        }
      }
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const from = symbolForDeclaration(node);
        for (const clause of node.heritageClauses || [])
          for (const type of clause.types) {
            const kind =
              clause.token === ts.SyntaxKind.ImplementsKeyword
                ? "implements"
                : "extends";
            addRelation(
              from,
              targetForNode(type.expression),
              kind,
              source,
              record,
              type.expression,
            );
          }
        const baseTypes = (node.heritageClauses || [])
          .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
          .flatMap((clause) => clause.types)
          .map((type) => checker.getTypeAtLocation(type));
        for (const member of node.members)
          if (ts.isMethodDeclaration(member) && member.name) {
            const name = member.name.getText(source);
            for (const baseType of baseTypes) {
              const property = checker.getPropertyOfType(baseType, name);
              for (const declaration of property?.declarations || [])
                addRelation(
                  symbolForDeclaration(member),
                  symbolForDeclaration(declaration),
                  "overrides",
                  source,
                  record,
                  member.name,
                );
            }
          }
      }
      if (ts.isInterfaceDeclaration(node))
        for (const clause of node.heritageClauses || [])
          for (const type of clause.types)
            addRelation(
              symbolForDeclaration(node),
              targetForNode(type.expression),
              "extends",
              source,
              record,
              type.expression,
            );
      if (ts.isIdentifier(node) && moduleVariableNames.has(node.text)) {
        const parent = node.parent;
        const declarationName =
          (ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node) ||
          ((ts.isFunctionDeclaration(parent) ||
            ts.isClassDeclaration(parent) ||
            ts.isInterfaceDeclaration(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isMethodSignature(parent) ||
            ts.isTypeAliasDeclaration(parent) ||
            ts.isEnumDeclaration(parent)) &&
            parent.name === node) ||
          ts.isImportClause(parent) ||
          ts.isImportSpecifier(parent) ||
          ts.isNamespaceImport(parent) ||
          ts.isExportSpecifier(parent);
        if (!declarationName) {
          const from = ownerFor(node);
          const to = targetForNode(node);
          if (from && to?.kind === "variable") {
            const usage =
              ts.isPropertyAccessExpression(parent) && parent.name === node
                ? parent
                : node;
            const usageParent = usage.parent;
            const binary =
              ts.isBinaryExpression(usageParent) && usageParent.left === usage;
            const assignment =
              binary &&
              usageParent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
              usageParent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
            const update =
              (ts.isPrefixUnaryExpression(usageParent) ||
                ts.isPostfixUnaryExpression(usageParent)) &&
              [
                ts.SyntaxKind.PlusPlusToken,
                ts.SyntaxKind.MinusMinusToken,
              ].includes(usageParent.operator);
            if (assignment || update)
              addRelation(from, to, "writes", source, record, node);
            if (
              !assignment ||
              update ||
              (binary &&
                usageParent.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
            )
              addRelation(from, to, "reads", source, record, node);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const bindings = new Map<string, Map<string, CodeSymbol>>();
  const bindingKey = (owner: CodeSymbol, name: string) =>
    `${owner.id}:parameter:${name}`;
  const targetsFor = (reference: TypeScriptCallableReference) =>
    reference.kind === "symbol"
      ? [reference.symbol]
      : [
          ...(bindings
            .get(bindingKey(reference.owner, reference.name))
            ?.values() || []),
        ];
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (const invocation of invocations) {
      for (const callee of targetsFor(invocation.callee)) {
        if (invocation.owner && invocation.callee.kind === "parameter")
          addCallFact(
            invocation.owner,
            callee,
            invocation.evidence,
            invocation.ordinal,
            "inferred",
            0.82,
          );
        const names = parameters.get(callee.id) || [];
        for (
          let index = 0;
          index < Math.min(names.length, invocation.arguments.length);
          index++
        ) {
          const key = bindingKey(callee, names[index]);
          const current = bindings.get(key) || new Map<string, CodeSymbol>();
          bindings.set(key, current);
          if (current.size >= 24) continue;
          const argument = invocation.arguments[index];
          if (!argument) continue;
          for (const target of targetsFor(argument))
            if (!current.has(target.id)) {
              current.set(target.id, target);
              changed = true;
            }
        }
      }
    }
    if (!changed) break;
  }
  return {
    calls: [...calls.values()].sort(
      (a, b) =>
        a.fromSourceSymbolId.localeCompare(b.fromSourceSymbolId) ||
        a.toSourceSymbolId.localeCompare(b.toSourceSymbolId),
    ),
    relations: [...relations.values()].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.fromSourceSymbolId.localeCompare(b.fromSourceSymbolId) ||
        a.toSourceSymbolId.localeCompare(b.toSourceSymbolId),
    ),
  };
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
        .find((item) => item.indent < indent)?.symbol;
      const kind: CodeSymbol["kind"] =
        definition[2] === "class"
          ? "class"
          : container?.kind === "class"
            ? "method"
            : "function";
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
  const indexedFiles = files.filter(
    (entry) =>
      SOURCE_EXTENSIONS.has(entry.extension) ||
      isArchitectureKnowledgePath(entry.path),
  );
  const sourceFiles = indexedFiles.filter((entry) => entry.size <= TEXT_LIMIT);
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
  const limits: AnalysisLimit[] = [];
  if (listing.truncated)
    limits.push({
      code: "file-index",
      reached: true,
      message:
        "The workspace file index reached its safety bound; coverage excludes remaining paths.",
    });
  const contents = new Map<string, string[]>();
  const typeScriptTexts = new Map<string, string>();
  const pythonTexts = new Map<string, string>();
  const rustTexts = new Map<string, string>();
  const knowledgeContents = new Map<string, string>();
  let authoredContent: string | null = null;
  let bytesRead = 0;
  let memoryCacheHits = 0;
  let persistentCacheHits = 0;
  let cacheMisses = 0;
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
    const cached = options.cache?.get(file.path);
    const invalidated = options.invalidatedPaths?.has(file.path) || false;
    const metadataHit = Boolean(
      !invalidated &&
      cached &&
      cached.size === file.size &&
      cached.mtimeMs === file.mtimeMs,
    );
    const authoredPath =
      file.path.replaceAll("\\", "/") === ".witch/analysis.json";
    const contentRequired =
      DEEP_EXTENSIONS.has(file.extension) ||
      authoredPath ||
      isArchitectureKnowledgePath(file.path) ||
      Boolean(cached?.imports.length);
    let content = metadataHit ? cached?.content : undefined;
    if (content !== undefined) memoryCacheHits++;
    else if (metadataHit && cached && !contentRequired) {
      // File-level-only languages need their durable hash and inventory, not
      // another full content read. Watcher invalidations still force a read.
      content = "";
      persistentCacheHits++;
    } else {
      try {
        content = await readWorkspaceText(root, file.path);
      } catch (error) {
        warnings.push(
          `${file.path}: ${error instanceof Error ? error.message : error}`,
        );
        continue;
      }
      if (metadataHit && cached?.persistent) persistentCacheHits++;
    }
    const hash = metadataHit && cached ? cached.hash : contentHash(content);
    if (authoredPath) authoredContent = content;
    bytesRead += file.size;
    const parsed: ParsedSource =
      metadataHit && cached?.hash === hash
        ? cached
        : /\.[cm]?[jt]sx?$/i.test(file.path)
          ? tsSymbolsAndImports(file.path, content)
          : file.extension === ".py"
            ? pythonSymbolsAndImports(file.path, content)
            : file.extension === ".rs"
              ? rustSymbolsAndImports(file.path, content)
              : { symbols: [], imports: [] };
    if (!metadataHit || cached?.hash !== hash) cacheMisses++;
    if (parsed.symbolIdCollisions)
      warnings.push(
        `${file.path}: disambiguated ${parsed.symbolIdCollisions} same-line symbol id collision${parsed.symbolIdCollisions === 1 ? "" : "s"} with exact source positions.`,
      );
    const duplicateSymbolIds = new Set<string>();
    const observedSymbolIds = new Set<string>();
    for (const item of parsed.symbols) {
      if (observedSymbolIds.has(item.id)) duplicateSymbolIds.add(item.id);
      observedSymbolIds.add(item.id);
    }
    const safeSymbols = duplicateSymbolIds.size ? [] : parsed.symbols;
    if (duplicateSymbolIds.size)
      warnings.push(
        `${file.path}: symbol-level analysis was isolated because ${duplicateSymbolIds.size} duplicate symbol id${duplicateSymbolIds.size === 1 ? " was" : "s were"} still present; file and import structure remain available.`,
      );
    if (/\.[cm]?[jt]sx?$/i.test(file.path))
      typeScriptTexts.set(file.path, content);
    if (file.extension === ".py") pythonTexts.set(file.path, content);
    if (file.extension === ".rs") rustTexts.set(file.path, content);
    if (isArchitectureKnowledgePath(file.path))
      knowledgeContents.set(file.path, content);
    options.cache?.set(file.path, {
      hash,
      ...parsed,
      size: file.size,
      mtimeMs: file.mtimeMs,
      content,
      persistent: false,
    });
    nodes.push({
      id: file.path,
      label: path.basename(file.path),
      kind: "file",
      path: file.path,
      module: moduleFor(file.path),
      language: file.extension.slice(1),
      hash,
      count: 1,
      symbols: safeSymbols,
      evidence: [{ path: file.path, line: 1, hash }],
    });
    imports.set(file.path, parsed.imports);
    contents.set(
      file.path,
      parsed.imports.length ? content.split(/\r?\n/) : [],
    );
  }
  if (budgetReached) {
    const message = `Source analysis reached its ${(options.byteBudget ?? 64_000_000) / 1_000_000} MB safety budget. Open a narrower project to include the remaining sources.`;
    warnings.push(message);
    limits.push({ code: "byte-budget", reached: true, message });
  }
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
  let symbolCalls: ResolvedSymbolCall[] = [];
  let symbolRelations: ResolvedSymbolRelation[] = [];
  const typeScriptBytes = [...typeScriptTexts.values()].reduce(
    (total, content) => total + Buffer.byteLength(content),
    0,
  );
  if (typeScriptTexts.size > 5_000 || typeScriptBytes > 64_000_000) {
    const message =
      "TypeScript symbol calls and type hierarchy were skipped because the analyzed program exceeds 5,000 files or 64 MB. File/import structure remains available.";
    warnings.push(message);
    limits.push({ code: "typescript-calls", reached: true, message });
  } else if (typeScriptTexts.size) {
    const facts = await typeScriptResolvedFacts(
      root,
      nodes,
      typeScriptTexts,
      resolveImport,
      options.signal,
    );
    symbolCalls = facts.calls;
    symbolRelations = facts.relations;
    if (symbolCalls.length >= 10_000) {
      const message =
        "TypeScript symbol calls reached the 10,000 relation display/index limit.";
      warnings.push(message);
      limits.push({ code: "symbol-calls", reached: true, message });
    }
    if (symbolRelations.length >= 30_000) {
      const message =
        "TypeScript symbol relations reached the 30,000 relation analysis limit.";
      warnings.push(message);
      limits.push({ code: "symbol-relations", reached: true, message });
    }
  }
  const [pythonCalls, rustCalls, pythonRelations, rustRelations] =
    await Promise.all([
      pythonResolvedCalls(nodes, pythonTexts, resolveImport, options.signal),
      rustResolvedCalls(nodes, rustTexts, resolveImport, options.signal),
      pythonResolvedTypeRelations(
        nodes,
        pythonTexts,
        resolveImport,
        options.signal,
      ),
      rustResolvedTypeRelations(
        nodes,
        rustTexts,
        resolveImport,
        options.signal,
      ),
    ]);
  symbolCalls = [...symbolCalls, ...pythonCalls, ...rustCalls].slice(0, 10_000);
  symbolRelations = [
    ...symbolRelations,
    ...pythonRelations,
    ...rustRelations,
  ].slice(0, 30_000);
  if (symbolCalls.length >= 10_000) {
    const message =
      "Polyglot symbol calls reached the 10,000 relation display/index limit.";
    warnings.push(message);
    if (!limits.some((item) => item.code === "symbol-calls"))
      limits.push({ code: "symbol-calls", reached: true, message });
  }
  if (symbolRelations.length >= 30_000) {
    const message =
      "Polyglot symbol relations reached the 30,000 relation analysis limit.";
    warnings.push(message);
    if (!limits.some((item) => item.code === "symbol-relations"))
      limits.push({ code: "symbol-relations", reached: true, message });
  }
  let callCorroborations: SymbolCallCorroboration[] = [];
  if (options.callCorroborator && (pythonCalls.length || rustCalls.length)) {
    try {
      const result = await options.callCorroborator({
        root,
        nodes,
        calls: symbolCalls,
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      callCorroborations = result.observations;
      warnings.push(...result.warnings);
      const sampleWarning = result.warnings.find((warning) =>
        /sampled \d+\/\d+/i.test(warning),
      );
      if (sampleWarning)
        limits.push({
          code: "lsp-sample",
          reached: true,
          message: sampleWarning,
        });
    } catch (error) {
      options.signal?.throwIfAborted();
      warnings.push(
        `Language-server call corroboration was skipped: ${error instanceof Error ? error.message : error}`,
      );
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
    symbolCalls,
    symbolRelations,
    callCorroborations,
  });
  const knowledge = analyzeArchitectureKnowledge({
    workspaceRoot: root,
    sourceRevision: revision,
    generatedAt,
    nodes,
    semantic: semantic.graph,
    contents: knowledgeContents,
  });
  const deepContents = new Map([
    ...typeScriptTexts,
    ...pythonTexts,
    ...rustTexts,
  ]);
  const frameworks = analyzeFrameworks({
    workspaceRoot: root,
    sourceRevision: revision,
    generatedAt,
    nodes,
    semantic: semantic.graph,
    contents: deepContents,
  });
  const behavior = buildBehaviorGraph({
    workspaceRoot: root,
    sourceRevision: revision,
    generatedAt,
    nodes,
    semantic: semantic.graph,
    contents: deepContents,
    symbolCalls,
    symbolRelations,
    frameworkCandidates: frameworks.candidates,
  });
  warnings.push(
    ...frameworks.diagnostics.map(
      (item) =>
        `${item.framework || "framework"}: ${item.message}${item.subject === "document" ? "" : ` (${item.subject})`}`,
    ),
  );
  if (frameworks.coverage.some((item) => item.limitReached))
    limits.push({
      code: "framework-candidates",
      reached: true,
      message:
        "Framework adapter candidates reached the bounded source-only analysis limit.",
    });
  warnings.push(...semantic.warnings);
  if (semantic.analysis.workflowLimitReached)
    limits.push({
      code: "workflow-count",
      reached: true,
      message: `Workflow inference emitted ${semantic.analysis.workflowsEmitted}/${semantic.analysis.workflowCandidates} candidates.`,
    });
  if (semantic.analysis.supportCandidatesOmitted)
    limits.push({
      code: "workflow-support",
      reached: true,
      message: `${semantic.analysis.supportCandidatesOmitted} test, documentation, example, fixture, or benchmark workflow candidates are hidden from the default production-first graph.`,
    });
  if (semantic.analysis.participantLimitReached)
    limits.push({
      code: "workflow-participants",
      reached: true,
      message:
        "Workflow participant projection reached a per-workflow or global bound.",
    });

  const analyzedPaths = new Set(
    nodes.flatMap((node) => (node.path ? [node.path] : [])),
  );
  const languages = new Map<
    string,
    Omit<AnalysisLanguageCoverage, "language" | "mode">
  >();
  for (const file of indexedFiles) {
    const language = coverageLanguage(file.extension);
    const current = languages.get(language) || {
      extensions: [],
      indexedFiles: 0,
      analyzedFiles: 0,
      deepFiles: 0,
      fileOnlyFiles: 0,
      skippedFiles: 0,
    };
    if (!current.extensions.includes(file.extension))
      current.extensions.push(file.extension);
    current.indexedFiles++;
    if (analyzedPaths.has(file.path)) {
      current.analyzedFiles++;
      if (DEEP_EXTENSIONS.has(file.extension)) current.deepFiles++;
      else current.fileOnlyFiles++;
    } else current.skippedFiles++;
    languages.set(language, current);
  }
  const languageCoverage: AnalysisLanguageCoverage[] = [...languages]
    .map(([language, item]) => ({
      language,
      ...item,
      extensions: item.extensions.sort(),
      mode:
        item.deepFiles && item.fileOnlyFiles
          ? ("partial" as const)
          : item.deepFiles
            ? ("deep" as const)
            : ("file-only" as const),
    }))
    .sort(
      (left, right) =>
        right.indexedFiles - left.indexedFiles ||
        left.language.localeCompare(right.language),
    );
  const coverage: AnalysisCoverage = {
    totalFiles: files.length,
    indexedFiles: indexedFiles.length,
    analyzedFiles: analyzedPaths.size,
    deepFiles: languageCoverage.reduce(
      (total, item) => total + item.deepFiles,
      0,
    ),
    fileOnlyFiles: languageCoverage.reduce(
      (total, item) => total + item.fileOnlyFiles,
      0,
    ),
    skippedFiles: indexedFiles.length - analyzedPaths.size,
    skippedOversizedFiles: indexedFiles.filter((file) => file.size > TEXT_LIMIT)
      .length,
    analyzedBytes: bytesRead,
    byteBudget: options.byteBudget ?? 64_000_000,
    cache: {
      memoryHits: memoryCacheHits,
      persistentHits: persistentCacheHits,
      misses: cacheMisses,
    },
    languages: languageCoverage,
    limits,
  };
  return finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: ARCHITECTURE_ANALYZER_VERSION,
    workspaceRoot: root,
    revision,
    generatedAt,
    nodes,
    edges,
    scannedFiles: contents.size,
    totalFiles: files.length,
    truncated: listing.truncated || budgetReached,
    warnings: warnings.slice(0, 100),
    coverage,
    semantic: semantic.graph,
    behavior,
    frameworks,
    knowledge,
  });
}
