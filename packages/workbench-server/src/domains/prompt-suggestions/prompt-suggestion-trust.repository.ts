import type { PromptSuggestionTrustStatus } from "@nervekit/contracts";
import { z } from "zod";
import { CanonicalStore } from "../../infrastructure/canonical-store/index.js";
import { storagePaths } from "../../infrastructure/storage/paths.js";
import type {
  RuntimeQueryCache,
  PromptSuggestionTrustCacheRecord,
} from "../../infrastructure/query-cache/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

const trustRecordSchema = z.object({
  trustId: z.string().min(1),
  sourceKind: z.enum(["user", "project"]),
  path: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  predicateHash: z.string().min(1),
  status: z.enum(["allowed", "denied"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PromptSuggestionTrustRecord = z.infer<typeof trustRecordSchema>;

export class PromptSuggestionTrustRepository {
  private readonly store: CanonicalStore;
  private readonly ready: Promise<void>;

  constructor(
    storage: InitializedStorage,
    // Kept in the constructor until the remaining query-only RuntimeQueryCache APIs
    // are removed; canonical SQLite is authoritative.
    private readonly queryCache: RuntimeQueryCache,
  ) {
    this.store =
      storage.canonicalStore ??
      new CanonicalStore(
        storage.paths.sqlitePath ?? storagePaths(storage.paths.home).sqlitePath,
      );
    this.ready = storage.canonicalStore
      ? Promise.resolve()
      : this.store.initialize();
  }

  async hydrateIndex(): Promise<void> {
    this.queryCache.replacePromptSuggestionTrust(await this.list());
  }

  async list(): Promise<PromptSuggestionTrustRecord[]> {
    await this.ready;
    return (
      await this.store.listDocuments<unknown>(
        "prompt_suggestion_trust",
        "global",
      )
    ).map((document) => trustRecordSchema.parse(document.data));
  }

  async get(trustId: string): Promise<PromptSuggestionTrustRecord | undefined> {
    await this.ready;
    const document = await this.store.readDocument<unknown>(
      "prompt_suggestion_trust",
      "global",
      trustId,
    );
    return document ? trustRecordSchema.parse(document.data) : undefined;
  }

  async set(
    input: Omit<
      PromptSuggestionTrustRecord,
      "createdAt" | "updatedAt" | "status"
    > & {
      status: Exclude<
        PromptSuggestionTrustStatus,
        "unset" | "stale" | "not_required"
      >;
    },
  ): Promise<PromptSuggestionTrustRecord> {
    const now = new Date().toISOString();
    await this.ready;
    const current = await this.store.readDocument<unknown>(
      "prompt_suggestion_trust",
      "global",
      input.trustId,
    );
    const existing = current
      ? trustRecordSchema.parse(current.data)
      : undefined;
    const next = trustRecordSchema.parse({
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.store.writeDocument({
      namespace: "prompt_suggestion_trust",
      scopeId: "global",
      documentId: input.trustId,
      data: next,
      expectedRevision: current?.revision ?? 0,
      now,
    });
    this.queryCache.upsertPromptSuggestionTrust(next);
    return next;
  }

  async remove(trustId: string): Promise<void> {
    await this.store.deleteDocument(
      "prompt_suggestion_trust",
      "global",
      trustId,
    );
    this.queryCache.deletePromptSuggestionTrust(trustId);
  }

  async statusesFromCache(): Promise<PromptSuggestionTrustCacheRecord[]> {
    return (await this.list()).map((record) => ({ ...record }));
  }
}
