import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../infrastructure/storage/json.js";

const enablementRecordSchema = z.object({
  definitionKey: z.string().min(1),
  enabled: z.boolean(),
  updatedAt: z.string().datetime(),
});
const enablementFileSchema = z.object({
  version: z.literal(1).default(1),
  records: z.array(enablementRecordSchema).default([]),
});

export type PromptSuggestionEnablementRecord = z.infer<
  typeof enablementRecordSchema
>;

export class PromptSuggestionEnablementRepository {
  private readonly path: string;
  private mutation = Promise.resolve();

  constructor(storage: InitializedStorage) {
    this.path = join(storage.paths.home, "prompt-suggestions", "enabled.json");
  }

  async list(): Promise<PromptSuggestionEnablementRecord[]> {
    if (!(await pathExists(this.path))) return [];
    const raw = await readJsonFile<unknown>(this.path).catch(() => undefined);
    const parsed = enablementFileSchema.safeParse(raw);
    return parsed.success ? parsed.data.records : [];
  }

  async set(definitionKey: string, enabled: boolean): Promise<void> {
    const operation = this.mutation.then(async () => {
      const records = await this.list();
      const next: PromptSuggestionEnablementRecord = {
        definitionKey,
        enabled,
        updatedAt: new Date().toISOString(),
      };
      await this.write([
        ...records.filter((record) => record.definitionKey !== definitionKey),
        next,
      ]);
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }

  private async write(records: PromptSuggestionEnablementRecord[]) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await atomicWriteJson(
      this.path,
      {
        version: 1,
        records: [...records].sort((left, right) =>
          left.definitionKey.localeCompare(right.definitionKey),
        ),
      },
      0o600,
    );
  }
}
