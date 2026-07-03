import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
export type SandboxSessionRecord = {
  sandboxId: string;
  sessionId: string;
  state: "connected" | "reconnecting" | "disconnected" | "exited";
  updatedAt: string;
  cursors?: unknown;
  capabilities?: string[];
  disconnectedAt?: string;
  closeCode?: number;
  closeReason?: string;
};
export class SessionStore {
  constructor(private readonly rootDir: string) {}
  async put(record: SandboxSessionRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const file = path.join(this.rootDir, `${record.sandboxId}.json`);
    await atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
  }
  async get(sandboxId: string): Promise<SandboxSessionRecord | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(this.rootDir, `${sandboxId}.json`), "utf8"),
      ) as SandboxSessionRecord;
    } catch {
      return undefined;
    }
  }
}
