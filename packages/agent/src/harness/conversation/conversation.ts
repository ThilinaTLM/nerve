import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.js";
import { ConversationError } from "../errors.js";
import type { ConversationContext } from "./context.js";
import { buildConversationContext } from "./context.js";
import type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
  CompactionEntry,
  ConversationInfoEntry,
  ConversationMetadata,
  ConversationStorage,
  ConversationTreeEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  MessageEntry,
  ModelChangeEntry,
  ThinkingLevelChangeEntry,
} from "./entries.js";

export { buildConversationContext } from "./context.js";

export class Conversation<
  TMetadata extends ConversationMetadata = ConversationMetadata,
> {
  private storage: ConversationStorage<TMetadata>;

  constructor(storage: ConversationStorage<TMetadata>) {
    this.storage = storage;
  }

  getMetadata(): Promise<TMetadata> {
    return this.storage.getMetadata();
  }

  getStorage(): ConversationStorage<TMetadata> {
    return this.storage;
  }

  getLeafId(): Promise<string | null> {
    return this.storage.getLeafId();
  }

  getEntry(id: string): Promise<ConversationTreeEntry | undefined> {
    return this.storage.getEntry(id);
  }

  getEntries(): Promise<ConversationTreeEntry[]> {
    return this.storage.getEntries();
  }

  async getBranch(fromId?: string): Promise<ConversationTreeEntry[]> {
    const leafId = fromId ?? (await this.storage.getLeafId());
    return this.storage.getPathToRoot(leafId);
  }

  async buildContext(): Promise<ConversationContext> {
    return buildConversationContext(await this.getBranch());
  }

  getLabel(id: string): Promise<string | undefined> {
    return this.storage.getLabel(id);
  }

  async getConversationName(): Promise<string | undefined> {
    const entries = await this.storage.findEntries("conversation_info");
    return entries[entries.length - 1]?.name?.trim() || undefined;
  }

  private async appendTypedEntry<TEntry extends ConversationTreeEntry>(
    entry: TEntry,
  ): Promise<string> {
    await this.storage.appendEntry(entry);
    return entry.id;
  }

  async appendMessage(message: AgentMessage): Promise<string> {
    return this.appendMessageWithId(
      await this.storage.createEntryId(),
      message,
    );
  }

  async appendMessageWithId(
    id: string,
    message: AgentMessage,
    timestamp = new Date().toISOString(),
  ): Promise<string> {
    if (await this.storage.getEntry(id)) return id;
    return this.appendTypedEntry({
      type: "message",
      id,
      parentId: await this.storage.getLeafId(),
      timestamp,
      message,
    } satisfies MessageEntry);
  }

  async appendHarnessMessageWithId(
    id: string,
    message: AgentMessage,
    timestamp = new Date().toISOString(),
  ): Promise<string> {
    return this.appendMessageWithId(id, message, timestamp);
  }

  async appendThinkingLevelChange(thinkingLevel: string): Promise<string> {
    return this.appendTypedEntry({
      type: "thinking_level_change",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      thinkingLevel,
    } satisfies ThinkingLevelChangeEntry);
  }

  async appendModelChange(provider: string, modelId: string): Promise<string> {
    return this.appendTypedEntry({
      type: "model_change",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    } satisfies ModelChangeEntry);
  }

  async appendActiveToolsChange(activeToolNames: string[]): Promise<string> {
    return this.appendTypedEntry({
      type: "active_tools_change",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      activeToolNames: [...activeToolNames],
    } satisfies ActiveToolsChangeEntry);
  }

  async appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "compaction",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    } satisfies CompactionEntry<T>);
  }

  async appendCustomEntry(customType: string, data?: unknown): Promise<string> {
    return this.appendTypedEntry({
      type: "custom",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      customType,
      data,
    } satisfies CustomEntry);
  }

  async appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "custom_message",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      customType,
      content,
      display,
      details,
    } satisfies CustomMessageEntry<T>);
  }

  async appendLabel(
    targetId: string,
    label: string | undefined,
  ): Promise<string> {
    if (!(await this.storage.getEntry(targetId))) {
      throw new ConversationError("not_found", `Entry ${targetId} not found`);
    }
    return this.appendTypedEntry({
      type: "label",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      targetId,
      label,
    } satisfies LabelEntry);
  }

  async appendConversationName(name: string): Promise<string> {
    return this.appendTypedEntry({
      type: "conversation_info",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      name: name.trim(),
    } satisfies ConversationInfoEntry);
  }

  async moveTo(
    entryId: string | null,
    summary?: { summary: string; details?: unknown; fromHook?: boolean },
  ): Promise<string | undefined> {
    if (entryId !== null && !(await this.storage.getEntry(entryId))) {
      throw new ConversationError("not_found", `Entry ${entryId} not found`);
    }
    await this.storage.setLeafId(entryId);
    if (!summary) return undefined;
    return this.appendTypedEntry({
      type: "branch_summary",
      id: await this.storage.createEntryId(),
      parentId: entryId,
      timestamp: new Date().toISOString(),
      fromId: entryId ?? "root",
      summary: summary.summary,
      details: summary.details,
      fromHook: summary.fromHook,
    } satisfies BranchSummaryEntry);
  }
}
