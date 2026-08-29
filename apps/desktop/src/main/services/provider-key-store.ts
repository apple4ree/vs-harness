import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readBoundedFile } from "./bounded-file";

export type ApiProviderId = "openai" | "anthropic";
export type EncryptedKeyStore = {
  version: 1;
  keys: Partial<
    Record<ApiProviderId, { encrypted: string; updatedAt: string }>
  >;
};

/** Stores ciphertext only. Failed/corrupt reads never turn into an empty overwrite. */
export class ProviderKeyStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private get target() {
    return path.join(this.directory, "api-keys.json");
  }
  private async load(): Promise<EncryptedKeyStore> {
    let bytes: Buffer;
    try {
      bytes = await readBoundedFile(this.target, 64_000);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, keys: {} };
      throw error;
    }
    const value = JSON.parse(bytes.toString("utf8"));
    if (
      !value ||
      value.version !== 1 ||
      !value.keys ||
      Array.isArray(value.keys) ||
      typeof value.keys !== "object" ||
      Object.entries(value.keys).some(
        ([provider, entry]: [string, any]) =>
          !["openai", "anthropic"].includes(provider) ||
          !entry ||
          typeof entry.encrypted !== "string" ||
          !entry.encrypted.length ||
          entry.encrypted.length > 48_000 ||
          !/^[a-zA-Z0-9+/]+={0,2}$/.test(entry.encrypted) ||
          typeof entry.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(entry.updatedAt)),
      )
    )
      throw new Error(
        "Stored provider credentials are invalid; the existing file has been preserved.",
      );
    return value;
  }
  async read() {
    await this.writes.catch(() => undefined);
    return this.load();
  }
  async update(mutate: (store: EncryptedKeyStore) => void) {
    const operation = this.writes
      .catch(() => undefined)
      .then(async () => {
        const store = await this.load();
        mutate(store);
        const content = JSON.stringify(store, null, 2) + "\n";
        if (Buffer.byteLength(content) > 64_000)
          throw new Error("Stored credentials exceed the size limit");
        await fs.mkdir(this.directory, { recursive: true });
        const temporary = path.join(
          this.directory,
          `api-keys.${randomUUID()}.tmp`,
        );
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          try {
            await handle.writeFile(content, "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(temporary, this.target);
        } finally {
          await fs.unlink(temporary).catch(() => undefined);
        }
      });
    this.writes = operation;
    await operation;
  }
  async flush() {
    await this.writes;
  }
}
