import { join } from "node:path";
import {
  type SessionEntry,
  type SessionRecord,
  type SessionTree,
  sessionEntrySchema,
} from "@nerve/shared";
import {
  appendJsonLine,
  type InitializedStorage,
  readJsonLines,
} from "../storage.js";

export class EntryRepository {
  constructor(private readonly storage: InitializedStorage) {}

  entriesPath(sessionId: string): string {
    return join(
      this.storage.paths.home,
      "sessions",
      sessionId,
      "entries.jsonl",
    );
  }

  async loadForSession(sessionId: string): Promise<SessionEntry[]> {
    const rawEntries = await readJsonLines<unknown>(
      this.entriesPath(sessionId),
    ).catch(() => []);
    return rawEntries
      .map((entry) => sessionEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
  }

  async append(entry: SessionEntry): Promise<void> {
    await appendJsonLine(this.entriesPath(entry.sessionId), entry, 0o600);
  }

  activeBranchEntries(
    entriesBySessionId: Map<string, SessionEntry[]>,
    session: SessionRecord,
  ): SessionEntry[] {
    const entries = entriesBySessionId.get(session.id) ?? [];
    if (!session.activeEntryId) return entries;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const branch: SessionEntry[] = [];
    let cursor: string | undefined = session.activeEntryId;
    while (cursor) {
      const entry = byId.get(cursor);
      if (!entry) break;
      branch.push(entry);
      cursor = entry.parentEntryId;
    }
    return branch.reverse();
  }

  getSessionTree(
    entriesBySessionId: Map<string, SessionEntry[]>,
    session: SessionRecord,
  ): SessionTree {
    const entries = entriesBySessionId.get(session.id) ?? [];
    const children = new Map<string, string[]>();
    const rootEntryIds: string[] = [];
    for (const entry of entries) {
      if (entry.parentEntryId) {
        const childEntryIds = children.get(entry.parentEntryId) ?? [];
        childEntryIds.push(entry.id);
        children.set(entry.parentEntryId, childEntryIds);
      } else {
        rootEntryIds.push(entry.id);
      }
    }
    return {
      sessionId: session.id,
      activeEntryId: session.activeEntryId,
      rootEntryIds,
      nodes: entries.map((entry) => ({
        entry,
        childEntryIds: children.get(entry.id) ?? [],
      })),
    };
  }
}
