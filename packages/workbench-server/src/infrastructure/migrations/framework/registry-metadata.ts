import type { MigrationRegistryEntry } from "./step.js";

/**
 * Ordered metadata shared by startup planning and the executable registry.
 * `previousChecksums` lists ledger checksums recorded by earlier shipped revisions
 * (or by stale draft labels) that applied homes may carry; see `docs/architecture/migrations.md`.
 */
export const MIGRATION_METADATA: readonly MigrationRegistryEntry[] =
  Object.freeze([
    {
      step: { id: "0001-conversation-core" },
      checksum:
        "0554278fe33a8cb9c7eea0658bfedd3ed7f17a1f792ca8c249f6044310b87e9f",
      // v0.35.0, v0.36.0-v0.37.0, and the v0.38.x-v0.39.x draft label.
      previousChecksums: [
        "f1bb93f70a4e4534064805ea1604e8ef1f8efe60d59e6cd01b4e9a1adbffe5dc",
        "6ebd6715209e5e283014d41b62a3983bd336f69ebeef7e186139376049a96021",
        "b548ad605a06952cb10dba894b4c99252e1f68db8d798f4fb61d3e4cb29db90b",
      ],
      stage: "released",
      releasedIn: "0.35.0",
    },
    {
      step: { id: "0002-agent-profiles" },
      checksum:
        "3e787a6b0fbb1b98184681e381e4c73c7e11c1bb05df53d70a6947b0e0474423",
      // Draft label recorded by v0.38.0-v0.39.x homes, then the revision released in
      // v0.38.0-v0.40.x, before its output was validated against frozen agent schemas, then the
      // 0.41 development revisions that froze the tool and image settings it imports.
      previousChecksums: [
        "4bc089e0c758119861523ef4234aa6f008206334d0a65cd524293c9908ca646e",
        "d38155a16d87079d02ba3e4fc140b9a0c4e7ad8b4f4c68612e98bcfe1ffed7d7",
        "893d816d07e9525e5b5f90f099c29145f0817935c6fafc5b7827ec1a65b4ad26",
      ],
      stage: "released",
      releasedIn: "0.38.0",
    },
    {
      step: { id: "0003-process-output-files" },
      checksum:
        "119be1caaafe005905a69b6cbfe495d99da383cfddb5882fbd5feb3a59d23ffd",
      stage: "released",
      releasedIn: "0.39.1",
    },
    {
      step: { id: "0004-task-result-notices" },
      checksum:
        "6b19831f2bc19fc3494b2835a3bc41507623e2a913e4c5b5fc0b1b62a08a14bc",
      stage: "released",
      releasedIn: "0.40.0",
    },
    {
      step: { id: "0005-extension-settings" },
      checksum:
        "90995c5489c9015b5bb6474d28ebda01bb7fb1de65bfe76c00b224f8cc657dcd",
      stage: "draft",
    },
  ]);
