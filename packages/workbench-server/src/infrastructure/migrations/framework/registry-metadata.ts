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
      rerunOnChange: true,
      checksum:
        "dec32b044d77f8b2b403f5e97b34da87c8ca7caa7f9acafb89e2fe8207a18f99",
      stage: "draft",
    },
  ]);
