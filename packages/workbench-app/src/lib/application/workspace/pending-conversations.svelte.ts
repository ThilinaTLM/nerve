import type { ConversationConfig } from "@nervekit/contracts/core";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { AgentProfilesDocument } from "@nervekit/contracts/agent-profiles";
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
  capabilityOverrides?: CapabilityOverridesDocument;
  agentProfileOverrides?: AgentProfilesDocument;
  /** Last successful first-send profile save; retained when submitting input fails. */
  agentProfileDigest?: string | null;
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
