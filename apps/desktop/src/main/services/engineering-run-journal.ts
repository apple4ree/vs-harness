import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  applyHarnessEvent,
  canonicalHarnessJson,
  createHarnessEvent,
  replayHarnessEvents,
} from "../../shared/engineering-run-reducer";
import type {
  AnyHarnessEvent,
  EngineeringRunProjection,
  HarnessEvent,
  HarnessEventPayloads,
  HarnessEventType,
} from "../../shared/engineering-run";

const RUN_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_JOURNAL_BYTES = 150_000_000;
const MAX_JOURNAL_EVENTS = 100_000;

export type EngineeringRunJournalManifest = {
  contract: "witch.engineering-run-journal/v1";
  schemaVersion: 1;
  runId: string;
  eventCount: number;
  lastSequence: number;
  eventDigest: string;
  state: EngineeringRunProjection["state"];
  createdAt: string;
  updatedAt: string;
};

function manifestFor(
  projection: EngineeringRunProjection,
): EngineeringRunJournalManifest {
  return {
    contract: "witch.engineering-run-journal/v1",
    schemaVersion: 1,
    runId: projection.runId,
    eventCount: projection.eventCount,
    lastSequence: projection.lastSequence,
    eventDigest: projection.eventDigest,
    state: projection.state,
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
  };
}

function manifestMatches(
  manifest: EngineeringRunJournalManifest | null | undefined,
  projection: EngineeringRunProjection,
) {
  if (!manifest) return false;
  const expected = manifestFor(projection);
  return (
    manifest.contract === expected.contract &&
    manifest.schemaVersion === expected.schemaVersion &&
    manifest.runId === expected.runId &&
    manifest.eventCount === expected.eventCount &&
    manifest.lastSequence === expected.lastSequence &&
    manifest.eventDigest === expected.eventDigest &&
    manifest.state === expected.state &&
    manifest.createdAt === expected.createdAt &&
    manifest.updatedAt === expected.updatedAt
  );
}

function assertRunId(runId: string) {
  if (!RUN_ID.test(runId)) throw new Error("Invalid Engineering Run id");
}

export class EngineeringRunJournal {
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  private directory(runId: string) {
    assertRunId(runId);
    return path.join(this.root, runId);
  }

  private async writeManifest(
    directory: string,
    projection: EngineeringRunProjection,
  ) {
    const target = path.join(directory, "manifest.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify(manifestFor(projection), null, 2)}\n`,
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async readManifest(directory: string) {
    const target = path.join(directory, "manifest.json");
    try {
      const stat = await fs.stat(target);
      if (stat.size > 1_000_000)
        throw new Error("Engineering Run manifest exceeds 1 MB");
      return JSON.parse(
        await fs.readFile(target, "utf8"),
      ) as EngineeringRunJournalManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async readEvents(runId: string) {
    const directory = this.directory(runId);
    const target = path.join(directory, "events.ndjson");
    let contents: string;
    try {
      const stat = await fs.stat(target);
      if (stat.size > MAX_JOURNAL_BYTES)
        throw new Error("Engineering Run journal exceeds 150 MB");
      contents = await fs.readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { directory, events: [] as AnyHarnessEvent[] };
      throw error;
    }
    if (contents && !contents.endsWith("\n"))
      throw new Error(
        "Engineering Run journal has an incomplete trailing record",
      );
    const lines = contents ? contents.slice(0, -1).split("\n") : [];
    if (lines.some((line) => !line))
      throw new Error("Engineering Run journal contains a blank record");
    if (lines.length > MAX_JOURNAL_EVENTS)
      throw new Error("Engineering Run journal exceeds 100,000 events");
    const events = lines.map((line, index) => {
      try {
        return JSON.parse(line) as AnyHarnessEvent;
      } catch (error) {
        throw new Error(
          `Engineering Run journal record ${index + 1} is invalid JSON: ${error}`,
        );
      }
    });
    return { directory, events };
  }

  private async readProjection(runId: string, repairManifest: boolean) {
    const { directory, events } = await this.readEvents(runId);
    if (!events.length) return null;
    const projection = replayHarnessEvents(events);
    if (projection.runId !== runId)
      throw new Error("Engineering Run journal belongs to another run");
    const manifest = await this.readManifest(directory);
    if (manifestMatches(manifest, projection)) return projection;

    // A crash can occur after a durable event append and before the atomic
    // manifest rename. Only a manifest that exactly matches an earlier prefix
    // is recoverable; all other mismatches fail closed as possible corruption.
    let recoverable = manifest === undefined;
    if (
      manifest &&
      Number.isSafeInteger(manifest.eventCount) &&
      manifest.eventCount > 0 &&
      manifest.eventCount < events.length
    ) {
      const prefix = replayHarnessEvents(events.slice(0, manifest.eventCount));
      recoverable = manifestMatches(manifest, prefix);
    }
    if (!recoverable)
      throw new Error(
        "Engineering Run manifest does not match the replayed event journal",
      );
    if (repairManifest) await this.writeManifest(directory, projection);
    return projection;
  }

  private serialize<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(runId) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(work);
    this.writes.set(
      runId,
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return operation;
  }

  async append<T extends HarnessEventType>(
    runId: string,
    type: T,
    payload: HarnessEventPayloads[T],
    timestamp = new Date().toISOString(),
  ) {
    return this.serialize(runId, async () => {
      const current = await this.readProjection(runId, true);
      const event = createHarnessEvent({
        id: randomUUID(),
        runId,
        sequence: (current?.lastSequence || 0) + 1,
        timestamp,
        type,
        payload,
      }) as HarnessEvent<T>;
      const projection = applyHarnessEvent(current, event as AnyHarnessEvent);
      const directory = this.directory(runId);
      await fs.mkdir(directory, { recursive: true });
      const handle = await fs.open(
        path.join(directory, "events.ndjson"),
        "a",
        0o600,
      );
      try {
        await handle.writeFile(`${canonicalHarnessJson(event)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.writeManifest(directory, projection);
      return projection;
    });
  }

  async import(events: readonly AnyHarnessEvent[]) {
    if (!events.length) throw new Error("Cannot import an empty journal");
    const runId = events[0].runId;
    assertRunId(runId);
    for (const event of events) {
      if (event.runId !== runId)
        throw new Error("Imported events must belong to one Engineering Run");
      await this.serialize(runId, async () => {
        const current = await this.readProjection(runId, true);
        const projection = applyHarnessEvent(current, event);
        if (projection === current) return;
        const directory = this.directory(runId);
        await fs.mkdir(directory, { recursive: true });
        const handle = await fs.open(
          path.join(directory, "events.ndjson"),
          "a",
          0o600,
        );
        try {
          await handle.writeFile(`${canonicalHarnessJson(event)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.writeManifest(directory, projection);
      });
    }
    return this.read(runId);
  }

  async read(runId: string) {
    await this.flush(runId);
    return this.readProjection(runId, true);
  }

  async verify(runId: string) {
    const projection = await this.read(runId);
    if (!projection) throw new Error("Engineering Run journal is missing");
    return projection;
  }

  async flush(runId: string) {
    await (this.writes.get(runId) || Promise.resolve());
  }
}
