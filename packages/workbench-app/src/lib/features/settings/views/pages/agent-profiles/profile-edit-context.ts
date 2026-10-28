import type { AvailableSkill } from "@nervekit/contracts/skills";
import type { ModelInfo } from "$lib/api";
import type {
  AccountOption,
  ToolId,
  ToolPayload,
} from "../tools/tool-settings";

/** Everything a change editor needs to offer valid choices. */
export type ProfileEditContext = {
  /** Authenticated models for the model picker. */
  models: ModelInfo[];
  permissionOptions: { value: string; label: string; detail?: string }[];
  skills: AvailableSkill[];
  /** Effective settings for this page scope, including inherited source defaults. */
  skillEnabled: (
    source: "file" | "nerve" | "agentBrowser",
    name: string,
  ) => boolean;
  defaultPermission?: string;
  accountsFor: (tool: ToolId) => AccountOption[];
  /** The user's current value of a tool, used as the starting point for a new change. */
  seedTool: (tool: ToolId) => ToolPayload;
  leadProfiles: { name: string; label: string }[];
};

/** An edit in progress: which change, its mode and its value. */
export type ChangeDraft = {
  key: import("./profile-changes").ChangeKey | "tool:";
  mode: import("./profile-changes").ChangeMode;
  value: unknown;
};
