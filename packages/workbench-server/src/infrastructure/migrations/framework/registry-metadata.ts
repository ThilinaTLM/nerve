import type { MigrationRegistryEntry } from "./step.js";

/** Ordered metadata shared by startup planning and the executable registry. */
export const MIGRATION_METADATA: readonly MigrationRegistryEntry[] =
  Object.freeze([
    {
      step: { id: "0001-conversation-core" },
      checksum:
        "ff3ad9d3b43fcbc678bcd8eec15f6a838efe81750448ad76a4445f0c18a06e23",
      stage: "draft",
    },
    {
      step: { id: "0002-agent-profiles" },
      rerunOnChange: true,
      checksum:
        "bb15ece4bbc7d0a323f4771be7c3f9e82d84f37aa5aad156b9f70b2aa13ed331",
      stage: "draft",
    },
  ]);
