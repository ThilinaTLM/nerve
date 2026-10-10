import type { RegisteredStep } from "../framework/step.js";
import conversationCore from "./0001-conversation-core/step.js";

/** Append steps in order; metadata must match migrations.lock.json. */
export const MIGRATION_REGISTRY: readonly RegisteredStep[] = Object.freeze([
  {
    step: conversationCore,
    checksum:
      "da556c83048c4c785dd6bf97e341beb21089ee530030265e841e9af577302f51",
    stage: "draft",
  },
]);
