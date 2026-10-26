import type { ConversationConfig } from "@nervekit/contracts/core";

/** Host validates a template and materializes it against application settings plus lead context. */
export interface SubagentHost {
  resolveProfile(input: { parentId: string; profile: string }): Promise<{
    name: string;
    /** Trusted preflight selection. The configuration host revalidates it at actual creation. */
    application: {
      config: Pick<ConversationConfig, "agentProfile"> &
        Partial<
          Pick<
            ConversationConfig,
            "model" | "reasoningLevel" | "permissionRuleSetId"
          >
        >;
    };
  }>;
  usableProfiles(parentId: string): Promise<string[]>;
}
