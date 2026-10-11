import { z } from "zod";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

const settingsSchema = z.object({ enabled: z.record(z.string(), z.boolean()) });

/** Per-profile switches in `config/subagents.json`; they override a file's `enabled`. */
export class SubagentEnablementService {
  private mutation = Promise.resolve();

  constructor(private readonly path: string) {}

  async list(): Promise<Record<string, boolean>> {
    try {
      return settingsSchema.parse(await readJsonFile<unknown>(this.path))
        .enabled;
    } catch {
      // Missing or unreadable preferences mean "no overrides"; the next save rewrites them.
      return {};
    }
  }

  async set(name: string, enabled: boolean): Promise<void> {
    const operation = this.mutation.then(async () => {
      const preferences = await this.list();
      preferences[name] = enabled;
      await atomicWriteJson(this.path, { enabled: preferences }, 0o600);
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }
}
