import type {
  LeadSettingsOverrides,
  ResolutionResult,
} from "@nervekit/contracts/agent-configuration";
/** Read-only presentation inputs, not a second persisted configuration DTO. */
export type AgentEditorView = {
  role?: "lead" | "child";
  resolution: ResolutionResult;
  overrides: LeadSettingsOverrides;
};
