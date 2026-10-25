import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { SvelteMap } from "svelte/reactivity";
export type PendingConversationState = {
  id: string;
  projectId: string;
  projectDir: string;
  title: "New Conversation";
  selectedModelKey: string;
  thinkingLevel: ConversationConfig["reasoningLevel"];
  agentProfile: ConversationConfig["agentProfile"];
  /** Only explicit composer choices are sent at creation; the host owns defaults. */
  explicitAgentProfile?: string;
  permissionRuleSetId: string;
  overrides?: LeadSettingsOverrides;
  /** Authoritative lower layer, excluding profile requirements and draft choices. */
  inheritedSettings?: LeadSettingsOverrides;
  sending: boolean;
  error?: string;
  createdConversationId?: string;
  createdAt: string;
  config: Omit<ConversationConfig, "conversationId">;
};
export const pendingConversations = new SvelteMap<
  string,
  PendingConversationState
>();
