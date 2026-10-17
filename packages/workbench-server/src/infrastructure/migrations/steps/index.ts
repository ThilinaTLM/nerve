import type { RegisteredStep } from "../framework/step.js";
import { MIGRATION_METADATA } from "../framework/registry-metadata.js";
import conversationCore from "./0001-conversation-core/step.js";

/** Append implementations in metadata order; the migration checker verifies both. */
const implementations = [conversationCore];
if (implementations.length !== MIGRATION_METADATA.length)
  throw new Error("Migration metadata and implementations must match.");

export const MIGRATION_REGISTRY: readonly RegisteredStep[] = Object.freeze(
  MIGRATION_METADATA.map((metadata, index) => {
    const step = implementations[index];
    if (!step || step.id !== metadata.step.id)
      throw new Error(`Migration implementation mismatch: ${metadata.step.id}`);
    return { ...metadata, step };
  }),
);
