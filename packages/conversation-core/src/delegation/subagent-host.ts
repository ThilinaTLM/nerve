import type { AgentProfileApplication } from "../ports.js";

/** Host validates a template and materializes it against application settings plus lead context. */
export interface SubagentHost {
  resolveProfile(input: { parentId: string; profile: string }): Promise<{
    name: string;
    /** Captured during preflight; creation uses this exact snapshot, never re-resolves the file. */
    application: AgentProfileApplication;
  }>;
  usableProfiles(parentId: string): Promise<string[]>;
}
