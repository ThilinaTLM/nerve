import type { RegisteredStep } from "../framework/step.js";
import conversationCore from "./0001-conversation-core/step.js";

/** Append steps in order; metadata must match migrations.lock.json. */
export const MIGRATION_REGISTRY: readonly RegisteredStep[] = Object.freeze([
  {
    step: conversationCore,
    checksum:
      "f1bb93f70a4e4534064805ea1604e8ef1f8efe60d59e6cd01b4e9a1adbffe5dc",
    stage: "draft",
  },
]);
