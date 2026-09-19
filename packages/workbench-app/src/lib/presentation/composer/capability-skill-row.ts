import type { SkillSource } from "@nervekit/contracts/skills";

/** One skill row in the composer, already resolved for this conversation. */
export type CapabilitySkillRow = {
  /** Stable `${kind}:${name}` identity; source families never merge. */
  key: string;
  name: string;
  source: SkillSource;
  kind: "file" | "nerve" | "agentBrowser";
  enabled: boolean;
  /** Set on this conversation rather than inherited. */
  overridden: boolean;
  inheritedFrom: "project" | "user";
};
