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
        "15b23510e159c4d2530ecda888a3528d51fba1a005f533c1aa0d65e6c4881504",
      stage: "draft",
    },
  ]);
