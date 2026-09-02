import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ignore from "ignore";
import { readBoundedFile } from "./bounded-file";

export const TEXT_LIMIT = 1_500_000;
const pendingSaves = new Map<string, Promise<unknown>>();
export const isEditorTemporary = (name: string) =>
  /^\.witch-save-[a-f0-9-]+\.tmp$/i.test(name);
export const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  "release",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  "test-results",
  "playwright-report",
  ".idea",
  ".witch-runs",
]);
export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
  extension: string;
  size: number;
  /** Used only as an incremental-index hint; source hashes remain canonical. */
  mtimeMs?: number;
};
export type FileListing = {
  entries: WorkspaceEntry[];
  truncated: boolean;
  warnings: string[];
};

export function contentHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizedRelative(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    value.includes("\0")
  )
    throw new Error("A valid workspace-relative path is required");
  if (path.isAbsolute(value) || path.win32.isAbsolute(value))
    throw new Error("Absolute paths are not allowed");
  const parts = value.replaceAll("\\", "/").split("/");
  if (parts.some((part) => part === ".." || part.includes(":")))
    throw new Error("Path escapes the workspace");
  if (
    parts.some(
      (part) =>
        part &&
        part !== "." &&
        (/[. ]$/.test(part) ||
          /[<>"|?*\u0000-\u001f]/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),
    )
  )
    throw new Error(
      "Use a portable file name without reserved device names, trailing dots/spaces, or control characters",
    );
  const normalized = parts.filter((part) => part && part !== ".").join("/");
  if (!normalized) throw new Error("The workspace root is protected");
  return normalized;
}

/** Checks every ancestor, including junctions, before touching a workspace path. */
export async function resolveWorkspacePath(
  root: string,
  value: unknown,
  allowMissing = false,
): Promise<string> {
  const relative = normalizedRelative(value);
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new Error("The workspace root was replaced by a symbolic link");
  const realRoot = await fs.realpath(root);
  let current = realRoot;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await fs
      .lstat(current)
      .catch((error: NodeJS.ErrnoException) => {
        if (allowMissing && error.code === "ENOENT") return null;
        throw error;
      });
    if (!stat) continue;
    if (stat.isSymbolicLink())
      throw new Error(
        "Symbolic links and junctions cannot be accessed through the workspace editor",
      );
    if (index < parts.length - 1 && !stat.isDirectory())
      throw new Error("A parent path is not a folder");
  }
  const result = path.relative(realRoot, current);
  if (
    !result ||
    result === ".." ||
    result.startsWith(`..${path.sep}`) ||
    path.isAbsolute(result)
  )
    throw new Error("Path escapes the workspace");
  return current;
}

export function assertMutablePath(value: string) {
  const relative = normalizedRelative(value);
  if (relative.split("/").some((part) => part.toLowerCase() === ".git"))
    throw new Error("Git metadata is protected");
  return relative;
}

export async function listWorkspace(
  root: string,
  limit = 20_000,
  respectIgnore = true,
): Promise<FileListing> {
  const entries: WorkspaceEntry[] = [];
  const warnings: string[] = [];
  const patterns = ignore();
  const rootIgnore = await fs
    .readFile(path.join(root, ".gitignore"), "utf8")
    .catch(() => "");
  if (respectIgnore) patterns.add(rootIgnore);
  let truncated = false;
  async function visit(relative: string, inherited: ReturnType<typeof ignore>) {
    if (entries.length >= limit) {
      truncated = true;
      return;
    }
    const directory = path.join(root, relative);
    const local = ignore().add(inherited);
    if (relative && respectIgnore)
      local.add(
        (
          await fs
            .readFile(path.join(directory, ".gitignore"), "utf8")
            .catch(() => "")
        )
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith("#"))
          .map((line) => {
            const negate = line.startsWith("!");
            const pattern = negate ? line.slice(1) : line;
            const anchored =
              pattern.startsWith("/") ||
              pattern.replace(/\/$/, "").includes("/");
            const clean = pattern.replace(/^\//, "");
            return `${negate ? "!" : ""}${relative}/${anchored ? "" : "**/"}${clean}`;
          }),
      );
    const children = await fs
      .readdir(directory, { withFileTypes: true })
      .catch((error: Error) => {
        warnings.push(`${relative || "."}: ${error.message}`);
        return [];
      });
    children.sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    );
    for (const child of children) {
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
      if (child.isSymbolicLink()) continue;
      if (isEditorTemporary(child.name)) continue;
      const itemPath = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory() && DEFAULT_IGNORES.has(child.name)) continue;
      if (local.ignores(itemPath + (child.isDirectory() ? "/" : ""))) continue;
      if (child.isDirectory()) {
        entries.push({
          path: itemPath,
          kind: "directory",
          extension: "",
          size: 0,
        });
        await visit(itemPath, local);
      } else if (child.isFile()) {
        const stat = await fs.stat(path.join(root, itemPath)).catch(() => null);
        if (stat)
          entries.push({
            path: itemPath,
            kind: "file",
            extension: path.extname(child.name).toLowerCase(),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
      }
    }
  }
  await visit("", patterns);
  return { entries, truncated, warnings };
}

export async function readWorkspaceText(root: string, relative: string) {
  const target = await resolveWorkspacePath(root, relative);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > TEXT_LIMIT)
    throw new Error("Only text files smaller than 1.5 MB can be opened");
  const bytes = await readBoundedFile(target, TEXT_LIMIT);
  return decodeWorkspaceText(bytes);
}

export function decodeWorkspaceText(bytes: Buffer): string {
  if (bytes.length > TEXT_LIMIT)
    throw new Error("Only text files smaller than 1.5 MB can be opened");
  if (bytes.includes(0))
    throw new Error("This is a binary file; it cannot be edited as text");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(
      "This file is not valid UTF-8. Convert its encoding before editing in Witch.",
    );
  }
}

export async function writeWorkspaceText(
  root: string,
  relative: string,
  content: string,
  expectedHash?: string,
) {
  assertMutablePath(relative);
  if (typeof content !== "string" || Buffer.byteLength(content) > TEXT_LIMIT)
    throw new Error("Text exceeds the editor size limit");
  if (content.includes("\0"))
    throw new Error("Binary content cannot be saved as text");
  const absolute = path.resolve(root, relative);
  const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const previous = pendingSaves.get(key) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => atomicSave(root, relative, content, expectedHash));
  pendingSaves.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pendingSaves.get(key) === operation) pendingSaves.delete(key);
  }
}

async function atomicSave(
  root: string,
  relative: string,
  content: string,
  expectedHash?: string,
) {
  const target = await resolveWorkspacePath(root, relative);
  const before = await readWorkspaceText(root, relative);
  if (expectedHash && contentHash(before) !== expectedHash)
    throw new Error(
      "The file changed on disk. Reload or review your changes before saving.",
    );
  const stat = await fs.stat(target);
  const temporary = path.join(
    path.dirname(target),
    `.witch-save-${randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporary, "wx", stat.mode & 0o777);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    // Revalidate after preparing the complete replacement; never truncate the original.
    await resolveWorkspacePath(root, relative);
    if (
      contentHash(await readWorkspaceText(root, relative)) !==
      contentHash(before)
    )
      throw new Error(
        "The file changed on disk while saving. Your editor buffer was kept.",
      );
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
  return { size: Buffer.byteLength(content), hash: contentHash(content) };
}
