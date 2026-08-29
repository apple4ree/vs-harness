import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contentHash, normalizedRelative, TEXT_LIMIT } from "./workspace-files";
import type {
  SessionSnapshot,
  SessionUpdate,
  WorkspaceSession,
} from "../../shared/session";

const SESSION_LIMIT = 16_000_000;
export class SessionStore {
  private writes = new Map<string, Promise<unknown>>();
  private corrupt = new Set<string>();
  constructor(private directory: string) {}
  async flush() {
    await Promise.all([...this.writes.values()]);
  }
  private key(root: string) {
    const absolute = path.resolve(root);
    return contentHash(
      process.platform === "win32" ? absolute.toLowerCase() : absolute,
    );
  }
  private target(root: string) {
    return path.join(this.directory, this.key(root) + ".json");
  }
  private validate(root: string, value: SessionUpdate): WorkspaceSession {
    if (
      !value ||
      this.key(value.root) !== this.key(root) ||
      !Array.isArray(value.documents) ||
      value.documents.length > 100 ||
      !["architecture", "source"].includes(value.view)
    )
      throw new Error("Invalid workspace session");
    let total = 0;
    const seen = new Set<string>();
    const documents = value.documents.map((document) => {
      const relative = normalizedRelative(document.path);
      if (seen.has(relative)) throw new Error("Duplicate session document");
      seen.add(relative);
      if (!document.draft) return { path: relative };
      const { content, savedContent, hash } = document.draft;
      if (
        typeof content !== "string" ||
        typeof savedContent !== "string" ||
        content.includes("\0") ||
        savedContent.includes("\0") ||
        Buffer.byteLength(content) > TEXT_LIMIT ||
        Buffer.byteLength(savedContent) > TEXT_LIMIT ||
        hash !== contentHash(savedContent)
      )
        throw new Error("Invalid recovery draft");
      total += Buffer.byteLength(content) + Buffer.byteLength(savedContent);
      if (total > SESSION_LIMIT)
        throw new Error(
          "Recovery drafts exceed 16 MB. Save or close some files.",
        );
      return { path: relative, draft: { content, savedContent, hash } };
    });
    return {
      version: 1,
      root,
      documents,
      activePath:
        value.activePath && seen.has(value.activePath)
          ? value.activePath
          : documents[0]?.path || null,
      view: value.view,
      updatedAt: new Date().toISOString(),
    };
  }
  private async write(root: string, operation: () => Promise<void>) {
    const key = this.key(root);
    const pending = (this.writes.get(key) || Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.writes.set(key, pending);
    try {
      await pending;
    } finally {
      if (this.writes.get(key) === pending) this.writes.delete(key);
    }
  }
  private async read(root: string, target: string): Promise<WorkspaceSession> {
    if ((await fs.stat(target)).size > SESSION_LIMIT * 2)
      throw new Error("Recovery session exceeds size limit");
    const raw = JSON.parse(await fs.readFile(target, "utf8"));
    if (raw.version !== 1)
      throw new Error("Unsupported recovery session version");
    return { ...this.validate(root, raw), updatedAt: raw.updatedAt };
  }
  async get(root: string): Promise<SessionSnapshot> {
    await this.writes.get(this.key(root))?.catch(() => undefined);
    const target = this.target(root);
    try {
      return { session: await this.read(root, target) };
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (!missing) this.corrupt.add(target);
      try {
        return {
          session: await this.read(root, target + ".previous"),
          warning:
            "The latest editor session could not be read. A previous recovery snapshot was restored; the damaged file will be retained separately.",
        };
      } catch (backupError) {
        if (missing && (backupError as NodeJS.ErrnoException).code === "ENOENT")
          return { session: null };
      }
      return {
        session: null,
        warning: `Saved editor session could not be loaded. It has not been deleted. ${error}`,
      };
    }
  }
  async save(root: string, value: SessionUpdate) {
    const session = this.validate(root, value);
    await this.write(root, async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const target = this.target(root),
        temporary = target + ".tmp";
      // Retain a prior snapshot as a fallback for a truncated/corrupted journal.
      if (this.corrupt.has(target)) {
        await fs
          .copyFile(target, target + `.corrupt-${randomUUID()}`)
          .catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        this.corrupt.delete(target);
      } else {
        await fs.copyFile(target, target + ".previous").catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      await fs.writeFile(temporary, JSON.stringify(session), "utf8");
      await fs.rename(temporary, target);
    });
  }
  async discardDrafts(root: string) {
    const { session } = await this.get(root);
    if (session)
      await this.save(root, {
        ...session,
        documents: session.documents.map((document) => ({
          path: document.path,
        })),
      });
  }
}
