import type { RegisteredStep } from "../framework/step.js";
import conversationCore from "./0001-conversation-core/step.js";

/** Append steps in order; metadata must match migrations.lock.json. */
export const MIGRATION_REGISTRY: readonly RegisteredStep[] = Object.freeze([
  {
    step: conversationCore,
    checksum:
      "a575190298e627c663a3443231aa41c8da08402981140fb2d4a869d234ea9bb8",
    stage: "draft",
  },
]);
