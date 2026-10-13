import type { ConversationConfig } from "@nervekit/contracts/core";

/** Host port for sub-agent profiles; conversation-core itself knows nothing about profile files. */
export interface SubagentHost {
  /** Resolves a creation-time snapshot; throws an Error listing usable profiles when invalid. */
  resolveProfile(input: { parentId: string; profile: string }): Promise<{
    name: string;
    config: Partial<
      Pick<
        ConversationConfig,
        "model" | "reasoningLevel" | "permissionRuleSetId" | "instructions"
      >
    >;
    /** Writes child capabilities and harness from this already-resolved host snapshot. */
    initializeChild(childId: string): Promise<void>;
  }>;
  /** Names of the enabled, trusted profiles the parent can use. */
  usableProfiles(parentId: string): Promise<string[]>;
}
