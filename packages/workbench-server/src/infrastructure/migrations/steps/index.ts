import type { RegisteredStep } from "../framework/step.js";
import { MIGRATION_METADATA } from "../framework/registry-metadata.js";
import conversationCore from "./0001-conversation-core/step.js";
import agentProfiles from "./0002-agent-profiles/step.js";
import processOutputFiles from "./0003-process-output-files/step.js";
import taskResultNotices from "./0004-task-result-notices/step.js";
import extensionSettings from "./0005-extension-settings/step.js";

/** Append implementations in metadata order; the migration checker verifies both. */
const implementations = [
  conversationCore,
  agentProfiles,
  processOutputFiles,
  taskResultNotices,
  extensionSettings,
];
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
