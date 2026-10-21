import type { MigrationRegistryEntry } from "./step.js";

/** Ordered metadata shared by startup planning and the executable registry. */
export const MIGRATION_METADATA: readonly MigrationRegistryEntry[] =
  Object.freeze([
    {
      step: { id: "0001-conversation-core" },
      checksum:
        "6ebd6715209e5e283014d41b62a3983bd336f69ebeef7e186139376049a96021",
      stage: "draft",
    },
    {
      step: { id: "0002-agent-profiles" },
      checksum:
        "38293507b7844aac14855313653e63e5d5fe568640afe3a83adfc012e988832d",
      stage: "draft",
    },
  ]);
