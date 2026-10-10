import type { RegisteredStep } from "../framework/step.js";
import conversationCore from "./0001-conversation-core/step.js";

/** Append steps in order; metadata must match migrations.lock.json. */
export const MIGRATION_REGISTRY: readonly RegisteredStep[] = Object.freeze([
  {
    step: conversationCore,
    checksum:
      "e72055bf108c17f9e1060d75e3a7f61dedd032535982ea6ab5184695c9c0977a",
    stage: "draft",
  },
]);
