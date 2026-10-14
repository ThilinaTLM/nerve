import type { ConversationConfig } from "@nervekit/contracts/core";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { SubagentProfilesDocument } from "@nervekit/contracts/subagents";
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
  permissionRuleSetId: string;
  capabilityOverrides?: CapabilityOverridesDocument;
  subagentProfileOverrides?: SubagentProfilesDocument;
  /** Last successful first-send profile save; retained when submitting input fails. */
  subagentProfileDigest?: string | null;
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
