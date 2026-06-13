import type {
  AgentRecord,
  ConversationEntry,
  ConversationRecord,
  CreateAgentRequest,
  Mode,
  PermissionLevel,
  PromptRequest,
} from "@nerve/shared";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage/index.js";
import type { HarnessManager } from "../../conversations/harness-manager.js";
import type { AppendEntryFn } from "./message-mirror.js";

export interface SubagentRunnerDeps {
  storage: InitializedStorage;
  events: EventBus;
  harnessManager: HarnessManager;
  createAgent: (
    request: CreateAgentRequest,
    options?: { allowChildAuthorityExceed?: boolean },
  ) => Promise<AgentRecord>;
  runAgentPrompt: (
    agent: AgentRecord,
    request: PromptRequest,
  ) => Promise<ConversationEntry>;
  appendEntry: AppendEntryFn;
  getConversation: (conversationId: string) => ConversationRecord;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
}

export class SubagentRunner {
  constructor(private readonly deps: SubagentRunnerDeps) {}

  async runSubagent(
    parent: AgentRecord,
    args: Record<string, unknown>,
  ): Promise<{ agent: AgentRecord; summary: string }> {
    const task = stringArg(args, "task");
    const mode =
      modeArg(args.mode) ?? this.deps.storage.settings.defaultSubagentMode;
    const permissionLevel =
      permissionArg(args.permissionLevel) ??
      this.deps.storage.settings.defaultSubagentPermissionLevel;
    const child = await this.deps.createAgent(
      {
        conversationId: parent.conversationId,
        projectId: parent.projectId,
        projectDir: parent.projectDir,
        workerId: parent.workerId,
        parentAgentId: parent.id,
        task,
        mode,
        permissionLevel,
        workspaceScope: parent.workspaceScope,
        model: parent.model,
        thinkingLevel: parent.thinkingLevel,
      },
      { allowChildAuthorityExceed: true },
    );
    await this.deps.events.publish("agent.subagent_started", {
      parentAgentId: parent.id,
      childAgentId: child.id,
      task,
    });
    try {
      const childEntry = await this.deps.runAgentPrompt(child, {
        text: [
          "You are a child research/review agent.",
          "Complete the delegated task, then respond with a concise summary and any key evidence.",
          "Do not modify files unless your granted mode and permission explicitly allow it.",
          "",
          task,
        ].join("\n"),
      });
      const summaryEntry = await this.deps.appendEntry(
        {
          conversationId: parent.conversationId,
          agentId: parent.id,
          role: "system",
          kind: "subagent_summary",
          text: childEntry.text,
          summary: childEntry.text,
          fromEntryId: childEntry.id,
          details: { childAgentId: child.id },
        },
        { mirrorToHarness: false },
      );
      await this.deps.harnessManager.appendSummaryEntry(
        parent,
        summaryEntry,
        childEntry.id,
      );
      await this.deps.events.publish("agent.subagent_completed", {
        parentAgentId: parent.id,
        childAgentId: child.id,
        summary: childEntry.text,
        summaryEntry,
      });
      return { agent: child, summary: childEntry.text };
    } finally {
      await this.deps.updateConversation({
        ...this.deps.getConversation(parent.conversationId),
        activeAgentId: parent.id,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

export function modeArg(value: unknown): Mode | undefined {
  return value === "planning" || value === "coding" ? value : undefined;
}

export function permissionArg(value: unknown): PermissionLevel | undefined {
  return value === "read_only" ||
    value === "supervised" ||
    value === "autonomous"
    ? value
    : undefined;
}

export function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
}
