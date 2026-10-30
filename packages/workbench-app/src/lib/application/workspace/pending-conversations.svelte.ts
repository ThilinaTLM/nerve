import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { SvelteMap } from "svelte/reactivity";
export type PendingConversationState = {
  id: string;
  projectId: string;
  projectDir: string;
  title: "New Conversation";
  /** Only explicit composer choices are sent at creation; the host owns defaults. */
  explicitAgentProfile?: string;
  overrides?: LeadSettingsOverrides;
  sending: boolean;
  error?: string;
  createdConversationId?: string;
  createdAt: string;
  config: Pick<
    ConversationConfig,
    "systemPrompt" | "instructions" | "workingDirectory"
  >;
};
export const pendingConversations = new SvelteMap<
  string,
  PendingConversationState
>();
