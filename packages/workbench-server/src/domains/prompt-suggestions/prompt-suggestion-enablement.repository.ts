import { join } from "node:path";
import { z } from "zod";
import { CanonicalStore } from "../../infrastructure/canonical-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

const enablementRecordSchema = z.object({
  definitionKey: z.string().min(1),
  enabled: z.boolean(),
  updatedAt: z.string().datetime(),
});

export type PromptSuggestionEnablementRecord = z.infer<
  typeof enablementRecordSchema
>;

export class PromptSuggestionEnablementRepository {
  private mutation = Promise.resolve();
  private readonly store: CanonicalStore;
  private readonly ready: Promise<void>;

  constructor(storage: InitializedStorage) {
    this.store =
      storage.canonicalStore ??
      new CanonicalStore(
        storage.paths.sqlitePath ?? join(storage.paths.home, "state.sqlite"),
      );
    this.ready = storage.canonicalStore
      ? Promise.resolve()
      : this.store.initialize();
  }

  async list(): Promise<PromptSuggestionEnablementRecord[]> {
    await this.ready;
    return (
      await this.store.listDocuments<unknown>(
        "prompt_suggestion_enablement",
        "global",
      )
    ).map((document) => enablementRecordSchema.parse(document.data));
  }

  async set(definitionKey: string, enabled: boolean): Promise<void> {
    const operation = this.mutation.then(async () => {
      await this.ready;
      const now = new Date().toISOString();
      const current = await this.store.readDocument(
        "prompt_suggestion_enablement",
        "global",
        definitionKey,
      );
      await this.store.writeDocument({
        namespace: "prompt_suggestion_enablement",
        scopeId: "global",
        documentId: definitionKey,
        data: enablementRecordSchema.parse({
          definitionKey,
          enabled,
          updatedAt: now,
        }),
        expectedRevision: current?.revision ?? 0,
        now,
      });
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }
}
