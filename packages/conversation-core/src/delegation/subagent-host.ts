import type { AgentProfileApplication } from "../ports.js";

/** Host validates a template and materializes it against application settings plus lead context. */
export interface SubagentHost {
  resolveProfile(input: { parentId: string; profile: string }): Promise<{
    name: string;
    /** Trusted preflight selection. The configuration host revalidates it at actual creation. */
    application: Pick<AgentProfileApplication, "config">;
  }>;
  usableProfiles(parentId: string): Promise<string[]>;
}
