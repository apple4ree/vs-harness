import path from "node:path";
import { promises as fs, realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { JsonRpcProcess, type RpcMessage } from "./json-rpc";
import {
  normalizedRelative,
  resolveWorkspacePath,
  readWorkspaceText,
  TEXT_LIMIT,
} from "./workspace-files";
import type {
  Position,
  Range,
  Diagnostic,
  LanguageStatus,
  Completion,
  SourceLocation,
  RefactorPreview,
  CodeAction,
  HoverInfo,
  SignatureHelpInfo,
  SignatureContext,
} from "../../shared/language";

/** LSP documentation is untrusted display data, never a command or HTML fragment. */
function documentationMarkdown(value: any): string | undefined {
  if (typeof value === "string") return value.slice(0, 40_000);
  if (!value || typeof value.value !== "string") return undefined;
  const text: string = value.value.slice(0, 40_000);
  if (value.kind === "plaintext")
    return text.replace(/[\\`*_{}[\]()#+.!<>|]/g, "\\$&");
  if (typeof value.language === "string") {
    const longest = Math.max(
      2,
      ...(text.match(/`+/g) || []).map((part) => part.length),
    );
    const fence = "`".repeat(longest + 1);
    return `${fence}${value.language.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}\n${text}\n${fence}`;
  }
  return text;
}

export function applyTextEdits(
  content: string,
  edits: { range: Range; newText: string }[],
): string {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  content = content.slice(bom.length);
  const starts = [0];
  for (let i = 0; i < content.length; i++)
    if (content[i] === "\n") starts.push(i + 1);
  const offset = (position: Position) => {
    if (
      !Number.isInteger(position.line) ||
      !Number.isInteger(position.character) ||
      position.line < 0 ||
      position.line >= starts.length ||
      position.character < 0
    )
      throw new Error("Invalid refactor range");
    const lineEnd =
      position.line + 1 < starts.length
        ? starts[position.line + 1] -
          (content[starts[position.line + 1] - 2] === "\r" ? 2 : 1)
        : content.length;
    if (starts[position.line] + position.character > lineEnd)
      throw new Error("Refactor range exceeds the line");
    return starts[position.line] + position.character;
  };
  const changes = edits
    .map((edit) => ({
      start: offset(edit.range.start),
      end: offset(edit.range.end),
      text: edit.newText,
    }))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let previousStart = content.length + 1;
  for (const change of changes) {
    if (change.start > change.end || change.end > previousStart)
      throw new Error("Overlapping refactor edits");
    content =
      content.slice(0, change.start) + change.text + content.slice(change.end);
    previousStart = change.start;
  }
  return bom + content;
}

function canonicalPath(value: string) {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export class LanguageServer extends EventEmitter {
  private root: string | null = null;
  private rpc: JsonRpcProcess | null = null;
  private ready: Promise<void> | null = null;
  private connected = false;
  private documents = new Map<string, { version: number; content: string }>();
  private actions = new Map<string, { item: any; validate: () => void }>();
  private completions = new Map<
    string,
    { item: any; uri: string; version: number; root: string }
  >();
  private capturedEdits: any[] | null = null;
  constructor(
    private options: {
      runtime: string;
      entrypoint: string;
      tsserver: string;
      runAsNode?: boolean;
    },
  ) {
    super();
  }
  setWorkspace(root: string | null) {
    let canonicalRoot = root;
    if (root) canonicalRoot = canonicalPath(root);
    if (this.root !== canonicalRoot) {
      void this.stop().catch((error) =>
        this.emit("log", `Language-server cleanup: ${error}`),
      );
      this.root = canonicalRoot;
    }
  }
  async status(): Promise<LanguageStatus> {
    const installed = await fs
      .stat(this.options.entrypoint)
      .then(() => true)
      .catch(() => false);
    return {
      installed,
      connected: this.connected,
      message: this.connected
        ? "TypeScript / JavaScript language server connected"
        : installed
          ? "TypeScript / JavaScript ready"
          : "Language server files are missing",
    };
  }
  private relative(uri: string): string | null {
    if (!this.root || !uri.startsWith("file:")) return null;
    try {
      return normalizedRelative(
        path.relative(this.root, canonicalPath(fileURLToPath(uri))),
      );
    } catch {
      return null;
    }
  }
  private async uri(relative: string) {
    if (!this.root) throw new Error("Open a workspace first");
    const root = this.root;
    const absolute = await resolveWorkspacePath(root, relative);
    if (root !== this.root)
      throw new Error("The language-service workspace changed");
    return pathToFileURL(absolute).toString();
  }
  async start() {
    if (this.ready) return this.ready;
    if (!this.root) throw new Error("Open a workspace first");
    const root = this.root;
    const rpc = new JsonRpcProcess(
      this.options.runtime,
      [this.options.entrypoint, "--stdio"],
      "headers",
      {
        cwd: root,
        env: {
          ...process.env,
          ...(this.options.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
      },
    );
    this.rpc = rpc;
    rpc.on("notification", (message: RpcMessage) => {
      if (
        this.rpc !== rpc ||
        message.method !== "textDocument/publishDiagnostics"
      )
        return;
      const relative = this.relative(message.params.uri);
      if (!relative) return;
      const diagnostics: Diagnostic[] = (message.params.diagnostics || [])
        .filter((item: any) => item.range?.start && item.range?.end)
        .map((item: any) => ({
          message: item.message,
          severity: item.severity,
          start: item.range.start,
          end: item.range.end,
          code: item.code,
          source: item.source,
        }));
      this.emit("diagnostics", { path: relative, diagnostics });
    });
    rpc.on("request", (message: RpcMessage) => {
      if (message.method === "workspace/configuration")
        rpc.reply(
          message.id!,
          (message.params.items || []).map(() => ({})),
        );
      else if (message.method === "workspace/applyEdit") {
        this.capturedEdits?.push(message.params.edit);
        rpc.reply(message.id!, {
          applied: false,
          failureReason: "Witch requires the user to review edits first.",
        });
      } else if (
        message.method === "client/registerCapability" ||
        message.method === "window/workDoneProgress/create"
      )
        rpc.reply(message.id!, null);
      else
        rpc.reject(message.id!, `Witch does not implement ${message.method}`);
    });
    rpc.on("closed", (error: Error) => {
      if (this.rpc !== rpc) return;
      this.rpc = null;
      this.ready = null;
      this.connected = false;
      this.documents.clear();
      this.emit("status", {
        installed: true,
        connected: false,
        message: error.message,
      });
    });
    this.ready = (async () => {
      try {
        await rpc.request("initialize", {
          processId: process.pid,
          rootUri: pathToFileURL(root).toString(),
          workspaceFolders: [
            { uri: pathToFileURL(root).toString(), name: path.basename(root) },
          ],
          capabilities: {
            general: { positionEncodings: ["utf-16"] },
            textDocument: {
              synchronization: { didSave: true },
              publishDiagnostics: { relatedInformation: true },
              hover: { contentFormat: ["markdown", "plaintext"] },
              signatureHelp: {
                contextSupport: true,
                signatureInformation: {
                  documentationFormat: ["markdown", "plaintext"],
                  parameterInformation: { labelOffsetSupport: true },
                  activeParameterSupport: true,
                },
              },
              completion: {
                completionItem: {
                  snippetSupport: true,
                  insertReplaceSupport: true,
                  resolveSupport: {
                    properties: [
                      "documentation",
                      "detail",
                      "additionalTextEdits",
                    ],
                  },
                },
              },
              definition: { linkSupport: true },
              references: {},
              rename: { prepareSupport: true },
              codeAction: {
                codeActionLiteralSupport: {
                  codeActionKind: {
                    valueSet: [
                      "quickfix",
                      "refactor",
                      "source.organizeImports",
                    ],
                  },
                },
                resolveSupport: { properties: ["edit"] },
              },
            },
            workspace: {
              configuration: true,
              applyEdit: true,
              workspaceEdit: { documentChanges: true },
            },
          },
          initializationOptions: {
            hostInfo: "Witch",
            disableAutomaticTypingAcquisition: true,
            tsserver: {
              path: this.options.tsserver,
              fallbackPath: this.options.tsserver,
            },
            preferences: {
              includeCompletionsForModuleExports: true,
              includeCompletionsWithInsertText: true,
            },
          },
        });
        if (this.rpc !== rpc)
          throw new Error(
            "Workspace changed while starting the language server",
          );
        rpc.notify("initialized", {});
        this.connected = true;
        this.emit("status", await this.status());
      } catch (error) {
        if (this.rpc === rpc) void this.stop().catch(() => undefined);
        throw error;
      }
    })();
    return this.ready;
  }
  async sync(relative: string, content: string) {
    if (!/\.[cm]?[jt]sx?$/i.test(relative)) return;
    if (typeof content !== "string" || Buffer.byteLength(content) > TEXT_LIMIT)
      throw new Error("Document exceeds language-server limits");
    const root = this.root;
    const uri = await this.uri(relative);
    await this.start();
    if (this.root !== root)
      throw new Error("The language-service workspace changed");
    const existing = this.documents.get(uri);
    if (!existing) {
      const languageId = /tsx$/i.test(relative)
        ? "typescriptreact"
        : /jsx$/i.test(relative)
          ? "javascriptreact"
          : /[cm]?ts$/i.test(relative)
            ? "typescript"
            : "javascript";
      this.documents.set(uri, { content, version: 1 });
      this.rpc!.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          version: 1,
          languageId,
          text: content.replace(/^\uFEFF/, ""),
        },
      });
    } else if (existing.content !== content) {
      existing.version++;
      existing.content = content;
      this.rpc!.notify("textDocument/didChange", {
        textDocument: { uri, version: existing.version },
        contentChanges: [{ text: content.replace(/^\uFEFF/, "") }],
      });
    }
  }
  async close(relative: string) {
    if (!this.connected || !this.root) return;
    const uri = pathToFileURL(
      path.join(this.root, normalizedRelative(relative)),
    ).toString();
    if (this.documents.delete(uri))
      this.rpc!.notify("textDocument/didClose", { textDocument: { uri } });
  }
  private async documentParams(relative: string, position: Position) {
    if (!/\.[cm]?[jt]sx?$/i.test(relative))
      throw new Error(
        "Language intelligence currently supports TypeScript and JavaScript",
      );
    if (
      !Number.isInteger(position.line) ||
      !Number.isInteger(position.character) ||
      position.line < 0 ||
      position.character < 0
    )
      throw new Error("Invalid cursor position");
    const root = this.root;
    const uri = await this.uri(relative);
    await this.start();
    if (this.root !== root)
      throw new Error("The language-service workspace changed");
    if (!this.documents.has(uri))
      await this.sync(relative, await readWorkspaceText(this.root!, relative));
    const line = this.documents
      .get(uri)
      ?.content.replace(/^\uFEFF/, "")
      .split(/\r?\n/)[position.line];
    if (line === undefined || position.character > line.length)
      throw new Error("Cursor position is outside the synchronized document");
    return { textDocument: { uri }, position };
  }
  async completion(
    relative: string,
    position: Position,
  ): Promise<Completion[]> {
    const params = await this.documentParams(relative, position);
    const document = this.documents.get(params.textDocument.uri)!;
    const version = document.version;
    const rpc = this.rpc!;
    const result = await rpc.request("textDocument/completion", params);
    if (
      this.rpc !== rpc ||
      this.documents.get(params.textDocument.uri) !== document ||
      document.version !== version
    )
      return [];
    const prefix = document.content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      [position.line]?.slice(0, position.character)
      .match(/[\p{L}\p{N}_$]+$/u)?.[0]
      .toLowerCase();
    return (Array.isArray(result) ? result : result?.items || [])
      .filter(
        (item: any) =>
          !prefix ||
          String(item.filterText || item.label)
            .toLowerCase()
            .startsWith(prefix),
      )
      .slice(0, 250)
      .map((item: any) => {
        const id = randomUUID();
        this.completions.set(id, {
          item,
          uri: params.textDocument.uri,
          version,
          root: this.root!,
        });
        while (this.completions.size > 1000)
          this.completions.delete(this.completions.keys().next().value!);
        return this.completionValue(item, id);
      });
  }
  private completionValue(item: any, id: string): Completion {
    return {
      id,
      label: String(item.label),
      kind: item.kind,
      detail: item.detail,
      documentation:
        typeof item.documentation === "string"
          ? item.documentation
          : item.documentation?.value,
      insertText: item.textEdit?.newText || item.insertText || item.label,
      range: item.textEdit?.range || item.textEdit?.replace,
      insertTextFormat: item.insertTextFormat,
      sortText: item.sortText,
      filterText: item.filterText,
      additionalTextEdits: item.additionalTextEdits,
    };
  }
  async resolveCompletion(id: string): Promise<Completion> {
    const completion = this.completions.get(id);
    const valid = () =>
      completion &&
      completion.root === this.root &&
      this.documents.get(completion.uri)?.version === completion.version;
    if (!valid() || !completion || !this.rpc)
      throw new Error("Completion expired; request it again");
    const item = await this.rpc.request(
      "completionItem/resolve",
      completion.item,
    );
    if (!valid())
      throw new Error("The document changed while resolving completion");
    const edits = item.additionalTextEdits || [];
    if (!Array.isArray(edits) || edits.length > 100)
      throw new Error("Too many completion edits");
    const content = this.documents.get(completion.uri)!.content;
    if (Buffer.byteLength(applyTextEdits(content, edits)) > TEXT_LIMIT)
      throw new Error("Completion exceeds the editor size limit");
    // Only same-document text edits are returned. Server commands are never executed.
    return this.completionValue(item, id);
  }
  private async inspectAt(
    method: string,
    relative: string,
    position: Position,
    extra = {},
  ) {
    const params = await this.documentParams(relative, position);
    const rpc = this.rpc!;
    const document = this.documents.get(params.textDocument.uri)!;
    const version = document.version;
    const result = await rpc.request(method, { ...params, ...extra });
    if (
      this.rpc !== rpc ||
      this.documents.get(params.textDocument.uri) !== document ||
      document.version !== version
    )
      return null;
    return result;
  }
  async hover(relative: string, position: Position): Promise<HoverInfo | null> {
    const result = await this.inspectAt(
      "textDocument/hover",
      relative,
      position,
    );
    if (!result?.contents) return null;
    const contents = (
      Array.isArray(result.contents) ? result.contents : [result.contents]
    )
      .slice(0, 10)
      .map(documentationMarkdown)
      .filter((item: string | undefined): item is string => Boolean(item));
    return contents.length ? { contents, range: result.range } : null;
  }
  async signatureHelp(
    relative: string,
    position: Position,
    context?: SignatureContext,
  ): Promise<SignatureHelpInfo | null> {
    const result = await this.inspectAt(
      "textDocument/signatureHelp",
      relative,
      position,
      {
        context: {
          triggerKind:
            context && [1, 2, 3].includes(context.triggerKind)
              ? context.triggerKind
              : 1,
          triggerCharacter:
            typeof context?.triggerCharacter === "string"
              ? context.triggerCharacter.slice(0, 1)
              : undefined,
          isRetrigger: context?.isRetrigger === true,
        },
      },
    );
    if (!Array.isArray(result?.signatures) || !result.signatures.length)
      return null;
    const signatures = result.signatures.slice(0, 20).map((signature: any) => ({
      label: String(signature.label).slice(0, 40_000),
      documentation: documentationMarkdown(signature.documentation),
      parameters: (Array.isArray(signature.parameters)
        ? signature.parameters
        : []
      )
        .slice(0, 100)
        .map((parameter: any) => ({
          label:
            Array.isArray(parameter.label) &&
            parameter.label.length === 2 &&
            parameter.label.every(Number.isSafeInteger)
              ? (parameter.label as [number, number])
              : String(parameter.label),
          documentation: documentationMarkdown(parameter.documentation),
        })),
      activeParameter:
        Number.isSafeInteger(signature.activeParameter) &&
        signature.activeParameter >= 0
          ? signature.activeParameter
          : undefined,
    }));
    const activeSignature =
      Number.isSafeInteger(result.activeSignature) &&
      result.activeSignature >= 0 &&
      result.activeSignature < signatures.length
        ? result.activeSignature
        : 0;
    const activeParameter =
      Number.isSafeInteger(result.activeParameter) &&
      result.activeParameter >= 0
        ? result.activeParameter
        : 0;
    return { signatures, activeSignature, activeParameter };
  }
  async locations(
    kind: "definition" | "references",
    relative: string,
    position: Position,
  ): Promise<SourceLocation[]> {
    const result = await this.inspectAt(
      `textDocument/${kind}`,
      relative,
      position,
      kind === "references" ? { context: { includeDeclaration: true } } : {},
    );
    return (Array.isArray(result) ? result : result ? [result] : []).flatMap(
      (item: any) => {
        const relative = this.relative(item.targetUri || item.uri || "");
        const range = item.targetSelectionRange || item.range;
        return relative && range
          ? [{ path: relative, start: range.start, end: range.end }]
          : [];
      },
    );
  }
  private refactorGuard() {
    const root = this.root,
      rpc = this.rpc;
    const versions = [...this.documents].map(([uri, document]) => ({
      uri,
      document,
      version: document.version,
    }));
    return () => {
      if (
        root !== this.root ||
        rpc !== this.rpc ||
        versions.some(
          ({ uri, document, version }) =>
            this.documents.get(uri) !== document ||
            document.version !== version,
        )
      )
        throw new Error(
          "The workspace or documents changed. Request the refactor again.",
        );
    };
  }
  private async preview(
    title: string,
    edit: any,
    validate: () => void,
  ): Promise<RefactorPreview> {
    validate();
    const root = this.root!;
    const byPath = new Map<string, { range: Range; newText: string }[]>();
    const add = (uri: string, edits: any[]) => {
      const relative = this.relative(uri);
      if (!relative)
        throw new Error("Refactor touches a path outside this workspace");
      if (!Array.isArray(edits) || edits.length > 10_000)
        throw new Error("Refactor contains too many text edits");
      byPath.set(relative, [...(byPath.get(relative) || []), ...edits]);
      if (byPath.size > 200) throw new Error("Refactor exceeds 200 files");
    };
    for (const [uri, edits] of Object.entries(edit?.changes || {}))
      add(uri, edits as any[]);
    for (const item of edit?.documentChanges || []) {
      if (!item.textDocument)
        throw new Error(
          "File create/delete/rename code actions are not supported in this preview",
        );
      const document = this.documents.get(item.textDocument.uri);
      if (
        item.textDocument.version != null &&
        document &&
        item.textDocument.version !== document.version
      )
        throw new Error("The document changed while preparing the refactor");
      add(item.textDocument.uri, item.edits);
    }
    const changes = [];
    let total = 0;
    for (const [relative, edits] of byPath) {
      validate();
      const uri = await this.uri(relative);
      const before =
        this.documents.get(uri)?.content ??
        (await readWorkspaceText(root, relative));
      validate();
      const after = applyTextEdits(before, edits);
      if (Buffer.byteLength(after) > TEXT_LIMIT)
        throw new Error("Refactored file exceeds the editor size limit");
      total += Buffer.byteLength(before) + Buffer.byteLength(after);
      if (total > 12_000_000) throw new Error("Refactor preview exceeds 12 MB");
      if (before !== after) changes.push({ path: relative, before, after });
    }
    return { title, changes };
  }
  async rename(relative: string, position: Position, newName: string) {
    if (!newName.trim() || newName.length > 200 || /\s/.test(newName))
      throw new Error("Enter a valid symbol name");
    const params = await this.documentParams(relative, position);
    const validate = this.refactorGuard();
    const edit = await this.rpc!.request("textDocument/rename", {
      ...params,
      newName,
    });
    validate();
    if (!edit) throw new Error("This symbol cannot be renamed");
    return this.preview(`Rename to ${newName}`, edit, validate);
  }
  async codeActions(relative: string, range: Range): Promise<CodeAction[]> {
    const params = await this.documentParams(relative, range.start);
    const validate = this.refactorGuard();
    const result = await this.rpc!.request("textDocument/codeAction", {
      textDocument: params.textDocument,
      range,
      context: { diagnostics: [] },
    });
    validate();
    this.actions.clear();
    return (result || []).slice(0, 200).map((action: any) => {
      const id = randomUUID();
      this.actions.set(id, { item: action, validate });
      const command =
        typeof action.command === "string"
          ? action.command
          : action.command?.command;
      return {
        id,
        title: action.title,
        kind: action.kind,
        disabled:
          action.disabled?.reason ||
          (!action.edit &&
          !action.data &&
          command &&
          command !== "_typescript.organizeImports"
            ? "This action requires a server command that cannot be previewed safely."
            : undefined),
      };
    });
  }
  async resolveAction(id: string): Promise<RefactorPreview> {
    const stored = this.actions.get(id);
    if (!stored || !this.rpc)
      throw new Error("Code action expired; request it again");
    const { validate } = stored;
    validate();
    const rpc = this.rpc;
    let action = stored.item;
    if (action.data) action = await rpc.request("codeAction/resolve", action);
    validate();
    if (action.edit) return this.preview(action.title, action.edit, validate);
    const command =
      typeof action.command === "string" ? action : action.command;
    if (!command) throw new Error("This code action has no text edits");
    // Other bundled TS commands can create files or run install commands before
    // asking workspace/applyEdit. They must not run in a preview-only workflow.
    if (command.command !== "_typescript.organizeImports")
      throw new Error(
        "This action requires a server command that cannot be previewed safely.",
      );
    if (this.capturedEdits)
      throw new Error("Another refactor is being prepared");
    const captured: any[] = [];
    this.capturedEdits = captured;
    try {
      await rpc.request("workspace/executeCommand", command).catch((error) => {
        if (!captured.length) throw error;
      });
      validate();
      const previews = await Promise.all(
        captured.map((edit) => this.preview(action.title, edit, validate)),
      );
      return {
        title: action.title,
        changes: previews.flatMap((preview) => preview.changes),
      };
    } finally {
      if (this.capturedEdits === captured) this.capturedEdits = null;
    }
  }
  async stop() {
    const rpc = this.rpc;
    this.rpc = null;
    this.ready = null;
    this.connected = false;
    this.documents.clear();
    this.actions.clear();
    this.completions.clear();
    this.capturedEdits = null;
    if (rpc) {
      await rpc.request("shutdown", null, 1000).catch(() => undefined);
      await rpc.disposeAndWait();
    }
  }
}
