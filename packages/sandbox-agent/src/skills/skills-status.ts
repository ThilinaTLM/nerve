import type { ContextFileStatus, SkillStatus } from "@nervekit/shared";
export type SkillsLoadStatus = {
  status: "loaded" | "degraded" | "failed";
  contextFiles: ContextFileStatus[];
  skills: SkillStatus[];
  diagnostics: {
    level: "info" | "warn" | "error";
    message: string;
    path?: string;
  }[];
};
