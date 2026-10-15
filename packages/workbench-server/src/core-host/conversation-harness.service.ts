import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { sameCapabilityToolSettings } from "@nervekit/contracts/capabilities";
import {
  conversationHarnessSettingsSchema,
  type ConversationHarnessSettingsResult,
} from "@nervekit/contracts/core";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import { atomicWriteJson } from "../infrastructure/storage-bootstrap/index.js";
import { ConfigurationScopePaths } from "../infrastructure/configuration/scope-paths.js";

export interface ConversationHarnessOptions {
  dataPath: string;
  /** The user level (`<NERVE_HOME>/config/harness.json`). */
  userCompaction(): AutoCompactionSettings;
  /** User merged with the project's `.nerve/config/harness.json`. */
  projectCompaction(projectId: string): Promise<AutoCompactionSettings>;
  /** Throws when the conversation does not exist. */
  projectOf(conversationId: string): string;
  changed(projectId: string, conversationId: string): void;
}

/**
 * Conversation-level `harness.json`. Compaction resolves user → project →
 * conversation; a conversation value replaces the inherited one as a whole and
 * only exists while it differs from it.
 */
export class ConversationHarnessSettings {
  constructor(private readonly options: ConversationHarnessOptions) {}

  private path(conversationId: string, projectId?: string) {
    return new ConfigurationScopePaths({
      conversationsPath: join(this.options.dataPath, "conversations"),
      projectOf: (id) => this.options.projectOf(id),
    }).resolve(
      { scope: "conversation", conversationId, projectId },
      "harness.json",
    ).path;
  }

  private async read(conversationId: string) {
    try {
      return conversationHarnessSettingsSchema.parse(
        JSON.parse(await readFile(this.path(conversationId), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  /** The compaction setting a turn or manual compaction uses. */
  async compactionSettings(
    conversationId: string,
  ): Promise<AutoCompactionSettings> {
    const projectId = this.options.projectOf(conversationId);
    return (
      (await this.read(conversationId)).compaction ??
      (await this.options.projectCompaction(projectId))
    );
  }

  async get(
    projectId: string,
    conversationId: string,
  ): Promise<ConversationHarnessSettingsResult> {
    this.path(conversationId, projectId);
    const inherited = await this.options.projectCompaction(projectId);
    const own = (await this.read(conversationId)).compaction;
    const source = own
      ? "conversation"
      : sameCapabilityToolSettings(inherited, this.options.userCompaction())
        ? "user"
        : "project";
    return { compaction: { effective: own ?? inherited, source, inherited } };
  }

  /** `null` (or a value equal to the inherited one) removes the override. */
  async update(
    projectId: string,
    conversationId: string,
    compaction: AutoCompactionSettings | null,
  ): Promise<ConversationHarnessSettingsResult> {
    const { compaction: current } = await this.get(projectId, conversationId);
    if (
      compaction === null ||
      sameCapabilityToolSettings(compaction, current.inherited)
    )
      await rm(this.path(conversationId), { force: true });
    else await atomicWriteJson(this.path(conversationId), { compaction });
    this.options.changed(projectId, conversationId);
    return this.get(projectId, conversationId);
  }

  /** Initial override for a new sub-agent: the profile's explicit choice, kept as written. */
  async initialize(
    conversationId: string,
    compaction: AutoCompactionSettings,
  ): Promise<void> {
    await atomicWriteJson(this.path(conversationId), { compaction });
  }
}
