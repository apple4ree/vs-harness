import { EventEmitter } from "node:events";
import { accessSync, constants, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CodeAction,
  CallHierarchy,
  Completion,
  DocumentSymbol,
  HoverInfo,
  LanguageProviderId,
  LanguageStatus,
  Position,
  Range,
  RefactorPreview,
  SignatureContext,
  SignatureHelpInfo,
  SourceLocation,
  WatchedFileChange,
} from "../../shared/language";
import { LanguageServer } from "./language-server";

export function rustAnalyzerCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const configured = environment.WITCH_RUST_ANALYZER_PATH;
  if (configured && !platformPath.isAbsolute(configured))
    throw new Error("WITCH_RUST_ANALYZER_PATH must be an absolute path");
  const candidates = configured ? [configured] : [];
  if (platform === "win32") {
    candidates.push(
      path.win32.join(homeDirectory, ".cargo", "bin", "rust-analyzer.exe"),
    );
  } else {
    candidates.push(
      path.posix.join(homeDirectory, ".cargo", "bin", "rust-analyzer"),
      "/usr/bin/rust-analyzer",
      "/usr/local/bin/rust-analyzer",
      "/opt/homebrew/bin/rust-analyzer",
    );
  }
  return [...new Set(candidates)];
}

function isExecutable(file: string) {
  try {
    if (!path.isAbsolute(file) || !statSync(file).isFile()) return false;
    accessSync(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

export function findRustAnalyzerExecutable() {
  return rustAnalyzerCandidates().find(isExecutable) || null;
}

export class LanguageIntelligence extends EventEmitter {
  private root: string | null = null;
  constructor(private servers: LanguageServer[]) {
    super();
    if (!servers.length)
      throw new Error("At least one language server is required");
    for (const server of servers) {
      server.on("diagnostics", (event) => this.emit("diagnostics", event));
      server.on("log", (message) =>
        this.emit("log", `[${server.providerId}] ${message}`),
      );
      server.on("status", () => void this.publishStatus());
    }
  }

  private async publishStatus() {
    this.emit("status", await this.status());
  }

  setWorkspace(root: string | null) {
    if (this.root === root) return;
    this.root = root;
    for (const server of this.servers) server.setWorkspace(root);
    void this.publishStatus();
  }

  async status(): Promise<LanguageStatus> {
    const providers = await Promise.all(
      this.servers.map((server) => server.status()),
    );
    const ready = providers.filter((provider) => provider.installed).length;
    const connected = providers.filter((provider) => provider.connected).length;
    return {
      installed: ready > 0,
      connected: connected > 0,
      message: `${ready}/${providers.length} language servers ready${connected ? ` · ${connected} connected` : ""}`,
      providers,
    };
  }

  private serverFor(relative: string) {
    const server = this.servers.find((candidate) =>
      candidate.supports(relative),
    );
    if (!server)
      throw new Error(
        "Language intelligence supports TypeScript, JavaScript, Python, and Rust files",
      );
    return server;
  }

  private serverForId(value: string) {
    const id = value.split(":", 1)[0] as LanguageProviderId;
    const server = this.servers.find(
      (candidate) => candidate.providerId === id,
    );
    if (!server) throw new Error("Language-server result expired");
    return server;
  }

  async sync(relative: string, content: string) {
    const server = this.servers.find((candidate) =>
      candidate.supports(relative),
    );
    if (server) await server.sync(relative, content);
  }

  async close(relative: string) {
    const server = this.servers.find((candidate) =>
      candidate.supports(relative),
    );
    if (server) await server.close(relative);
  }

  watchedFiles(changes: WatchedFileChange[]) {
    for (const server of this.servers) server.watchedFiles(changes);
  }

  completion(relative: string, position: Position): Promise<Completion[]> {
    return this.serverFor(relative).completion(relative, position);
  }

  resolveCompletion(id: string): Promise<Completion> {
    return this.serverForId(id).resolveCompletion(id);
  }

  hover(relative: string, position: Position): Promise<HoverInfo | null> {
    return this.serverFor(relative).hover(relative, position);
  }

  signatureHelp(
    relative: string,
    position: Position,
    context?: SignatureContext,
  ): Promise<SignatureHelpInfo | null> {
    return this.serverFor(relative).signatureHelp(relative, position, context);
  }

  locations(
    kind: "definition" | "references",
    relative: string,
    position: Position,
  ): Promise<SourceLocation[]> {
    return this.serverFor(relative).locations(kind, relative, position);
  }

  outgoingCalls(
    relative: string,
    position: Position,
  ): Promise<CallHierarchy | null> {
    return this.serverFor(relative).outgoingCalls(relative, position);
  }

  documentSymbols(relative: string): Promise<DocumentSymbol[]> {
    return this.serverFor(relative).documentSymbols(relative);
  }

  setPythonEnvironment(executable?: string) {
    const python = this.servers.find(
      (server) => server.providerId === "python",
    );
    python?.updateConfiguration(
      "python",
      executable ? { pythonPath: executable } : {},
    );
  }

  rename(
    relative: string,
    position: Position,
    newName: string,
  ): Promise<RefactorPreview> {
    return this.serverFor(relative).rename(relative, position, newName);
  }

  codeActions(relative: string, range: Range): Promise<CodeAction[]> {
    return this.serverFor(relative).codeActions(relative, range);
  }

  resolveAction(id: string): Promise<RefactorPreview> {
    return this.serverForId(id).resolveAction(id);
  }

  async stop() {
    await Promise.all(this.servers.map((server) => server.stop()));
  }
}
