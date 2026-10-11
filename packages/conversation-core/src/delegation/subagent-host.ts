import type { ConversationConfig } from "@nervekit/contracts/core";

/** Host port for sub-agent profiles; conversation-core itself knows nothing about profile files. */
export interface SubagentHost {
  /** Validates and resolves a profile; throws an Error listing the usable profiles when invalid. */
  resolveProfile(input: { parentId: string; profile: string }): Promise<{
    name: string;
    config: Partial<
      Pick<
        ConversationConfig,
        "model" | "reasoningLevel" | "permissionRuleSetId" | "instructions"
      >
    >;
  }>;
  /** Names of the enabled, trusted profiles the parent can use. */
  usableProfiles(parentId: string): Promise<string[]>;
  /** Writes the child's capabilities.json and harness.json from the profile. */
  initializeChild(input: {
    parentId: string;
    childId: string;
    profile: string;
  }): Promise<void>;
}
