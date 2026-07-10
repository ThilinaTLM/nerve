import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PromptSuggestionTrustStatus } from "@nervekit/contracts";
import { z } from "zod";
import type {
  IndexStore,
  PromptSuggestionTrustIndexRecord,
} from "../../infrastructure/index-store/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../infrastructure/storage/json.js";

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

const trustFileSchema = z.object({
  version: z.literal(1).default(1),
  records: z.array(trustRecordSchema).default([]),
});

export type PromptSuggestionTrustRecord = z.infer<typeof trustRecordSchema>;

export class PromptSuggestionTrustRepository {
  private readonly path: string;

  constructor(
    storage: InitializedStorage,
    private readonly index: IndexStore,
  ) {
    this.path = join(storage.paths.home, "prompt-suggestions", "trust.json");
  }

  async hydrateIndex(): Promise<void> {
    this.index.replacePromptSuggestionTrust(await this.list());
  }

  async list(): Promise<PromptSuggestionTrustRecord[]> {
    if (!(await pathExists(this.path))) return [];
    const raw = await readJsonFile<unknown>(this.path).catch(() => undefined);
    const parsed = trustFileSchema.safeParse(raw);
    return parsed.success ? parsed.data.records : [];
  }

  async get(trustId: string): Promise<PromptSuggestionTrustRecord | undefined> {
    return (await this.list()).find((record) => record.trustId === trustId);
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
    const records = await this.list();
    const existing = records.find((record) => record.trustId === input.trustId);
    const next: PromptSuggestionTrustRecord = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.writeRecords([
      ...records.filter((record) => record.trustId !== input.trustId),
      next,
    ]);
    this.index.upsertPromptSuggestionTrust(next);
    return next;
  }

  async remove(trustId: string): Promise<void> {
    const records = (await this.list()).filter(
      (record) => record.trustId !== trustId,
    );
    await this.writeRecords(records);
    this.index.deletePromptSuggestionTrust(trustId);
  }

  async statusesFromIndex(): Promise<PromptSuggestionTrustIndexRecord[]> {
    return this.index.listPromptSuggestionTrust();
  }

  private async writeRecords(
    records: PromptSuggestionTrustRecord[],
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await atomicWriteJson(
      this.path,
      {
        version: 1,
        records: records.sort((a, b) => a.path.localeCompare(b.path)),
      },
      0o600,
    );
  }
}
