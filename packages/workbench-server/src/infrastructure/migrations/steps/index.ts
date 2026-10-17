import type { RegisteredStep } from "../framework/step.js";
import conversationCore from "./0001-conversation-core/step.js";

/** Append steps in order; metadata must match migrations.lock.json. */
export const MIGRATION_REGISTRY: readonly RegisteredStep[] = Object.freeze([
  {
    step: conversationCore,
    checksum:
      "6ebd6715209e5e283014d41b62a3983bd336f69ebeef7e186139376049a96021",
    stage: "draft",
  },
]);
