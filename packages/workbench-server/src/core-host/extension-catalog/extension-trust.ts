import { join } from "node:path";
import { z } from "zod";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";
import { hashExtensionContent } from "./content-hash.js";
import {
  buildConsent,
  grantSnapshot,
  newGrants,
  isEmptyGrant,
  type GrantSnapshot,
} from "./consent-summary.js";
import type {
  ExtensionTrustGate,
  ExtensionTrustVerdict,
  InstalledExtensionCandidate,
  InstalledExtensionKey,
} from "./trust-gate.js";

const grantsSchema = z.object({
  network: z.array(z.string()),
  capabilities: z.array(z.string()),
  accounts: z.array(z.string()),
  namespaces: z.record(z.string(), z.array(z.string())),
  tools: z.array(z.string()),
  ui: z.array(z.string()),
}) satisfies z.ZodType<GrantSnapshot>;

const recordSchema = z.object({
  source: z.enum(["user", "project"]),
  id: z.string(),
  folder: z.string(),
  /** Hash of every file under dist/ when consent was given (or the grants last shrank or code changed under a user extension). */
  contentHash: z.string(),
  grants: grantsSchema,
  consentedAt: z.string(),
});
export type ExtensionTrustRecord = z.infer<typeof recordSchema>;

const fileSchema = z.object({
  version: z.literal(1),
  records: z.record(z.string(), recordSchema),
});
type TrustFile = z.infer<typeof fileSchema>;

/** Trust is per source, id and folder: the same id in another folder is another extension. */
export const trustKey = (key: InstalledExtensionKey) =>
  `${key.source}:${key.id}:${key.folder}`;

/**
 * Consent and the on/off switch of installed extensions, in `<home>/config/extension-trust.json`
 * (read lazily, written atomically). Rules:
 *
 * - Nothing runs before consent.
 * - A project extension is pending again on any change of its content.
 * - A user extension keeps consent through a code-only change; a change that adds anything to
 *   its grants (network, accounts, capabilities, namespaces and operations, tools, UI) is pending
 *   again, with the new grants as the review. Removed grants need no consent.
 */
export class ExtensionTrust implements ExtensionTrustGate {
  readonly #path: string;
  readonly #now: () => Date;
  #file: Promise<TrustFile> | undefined;
  #writing: Promise<unknown> = Promise.resolve();

  constructor(options: { configDir: string; now?: () => Date }) {
    this.#path = join(options.configDir, "extension-trust.json");
    this.#now = options.now ?? (() => new Date());
  }

  async decide(
    candidate: InstalledExtensionCandidate,
  ): Promise<"trusted" | ExtensionTrustVerdict> {
    const key = trustKey(candidate);
    const file = await this.#load();
    const record = file.records[key];
    const contentHash = await hashExtensionContent(candidate.folder);
    if (record?.contentHash === contentHash) return "trusted";
    const grants = grantSnapshot(candidate.manifest);
    if (record && candidate.source === "user") {
      if (isEmptyGrant(newGrants(record.grants, grants))) {
        // Code-only change (or fewer grants): consent stands, and is narrowed to what is granted now.
        await this.#write((current) => {
          current.records[key] = { ...record, contentHash, grants };
        });
        return "trusted";
      }
    }
    return {
      decision: "pending",
      consent: buildConsent({
        manifest: candidate.manifest,
        contentHash,
        ...(record ? { previous: record.grants } : {}),
      }),
    };
  }

  async grant(
    candidate: InstalledExtensionCandidate,
    contentHash: string,
  ): Promise<boolean> {
    // The hash is of the files as they are now: consent never covers files the user did not review.
    if ((await hashExtensionContent(candidate.folder)) !== contentHash)
      return false;
    const key = trustKey(candidate);
    await this.#write((file) => {
      file.records[key] = {
        source: candidate.source,
        id: candidate.id,
        folder: candidate.folder,
        contentHash,
        grants: grantSnapshot(candidate.manifest),
        consentedAt: this.#now().toISOString(),
      };
    });
    return true;
  }

  async revoke(key: InstalledExtensionKey): Promise<void> {
    await this.#write((file) => {
      delete file.records[trustKey(key)];
    });
  }

  #load(): Promise<TrustFile> {
    // Missing or unreadable: nothing is consented (never the other way around); the next write replaces it.
    this.#file ??= readJsonFile(this.#path, fileSchema).catch(() => ({
      version: 1 as const,
      records: {},
    }));
    return this.#file;
  }

  #write(change: (file: TrustFile) => void): Promise<void> {
    const task = this.#writing.then(async () => {
      const file = structuredClone(await this.#load());
      change(file);
      await atomicWriteJson(this.#path, file, 0o600);
      this.#file = Promise.resolve(file);
    });
    this.#writing = task.catch(() => undefined);
    return task;
  }
}
