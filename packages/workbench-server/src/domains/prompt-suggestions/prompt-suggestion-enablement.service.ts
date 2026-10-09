import { join } from "node:path";
import { z } from "zod";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

const settingsSchema = z.object({
  version: z.literal(1),
  enabled: z.record(z.string(), z.boolean()),
});

/** User preferences are a settings file, not conversation facts. */
export class PromptSuggestionEnablementService {
  private readonly path: string;
  private mutation = Promise.resolve();

  constructor(configDir: string) {
    this.path = join(configDir, "prompt-suggestions.json");
  }

  async list(): Promise<Record<string, boolean>> {
    const raw = await readJsonFile<unknown>(this.path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { version: 1, enabled: {} };
        throw error;
      },
    );
    return settingsSchema.parse(raw).enabled;
  }

  async set(definitionKey: string, enabled: boolean): Promise<void> {
    if (!definitionKey.trim())
      throw new Error("A suggestion definition key is required");
    const operation = this.mutation.then(async () => {
      const preferences = await this.list();
      preferences[definitionKey] = enabled;
      await atomicWriteJson(
        this.path,
        { version: 1, enabled: preferences },
        0o600,
      );
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }
}
