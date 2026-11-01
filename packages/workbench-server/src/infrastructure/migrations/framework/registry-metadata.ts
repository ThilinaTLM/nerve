import type { MigrationRegistryEntry } from "./step.js";

/** Ordered metadata shared by startup planning and the executable registry. */
export const MIGRATION_METADATA: readonly MigrationRegistryEntry[] =
  Object.freeze([
    {
      step: { id: "0001-conversation-core" },
      checksum:
        "b548ad605a06952cb10dba894b4c99252e1f68db8d798f4fb61d3e4cb29db90b",
      stage: "draft",
    },
    {
      step: { id: "0002-agent-profiles" },
      rerunOnChange: true,
      checksum:
        "4bc089e0c758119861523ef4234aa6f008206334d0a65cd524293c9908ca646e",
      stage: "draft",
    },
  ]);
