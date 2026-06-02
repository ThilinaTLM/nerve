import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type SessionRecord, sessionRecordSchema } from "@nerve/shared";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../storage.js";

export class SessionRepository {
  constructor(private readonly storage: InitializedStorage) {}

  sessionDir(sessionId: string): string {
    return join(this.storage.paths.home, "sessions", sessionId);
  }

  sessionPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "session.json");
  }

  harnessPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "harness.jsonl");
  }

  async loadAll(): Promise<SessionRecord[]> {
    const root = join(this.storage.paths.home, "sessions");
    const sessions: SessionRecord[] = [];
    for (const sessionId of await listChildDirs(root)) {
      const parsed = sessionRecordSchema.safeParse(
        await readJsonFile<unknown>(this.sessionPath(sessionId)).catch(
          () => undefined,
        ),
      );
      if (parsed.success) sessions.push(parsed.data);
    }
    return sessions;
  }

  async write(session: SessionRecord): Promise<void> {
    await atomicWriteJson(this.sessionPath(session.id), session, 0o600);
  }

  async remove(sessionId: string): Promise<void> {
    await rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }
}
