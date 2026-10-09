import type { ConversationConfig } from "@nervekit/contracts/core";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import { SvelteMap } from "svelte/reactivity";
export type PendingConversationState = {
  id: string;
  projectId: string;
  projectDir: string;
  title: "New Conversation";
  composerText: string;
  selectedModelKey: string;
  thinkingLevel: ConversationConfig["reasoningLevel"];
  mode: ConversationConfig["mode"];
  permissionLevel: "autonomous";
  permissionRuleSetId: string;
  capabilityOverrides?: CapabilityOverridesDocument;
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
