#!/usr/bin/env node
import {
  fail,
  formatStep,
  lockState,
  setChecksum,
  writeJson,
} from "./command-support.mjs";

const requestedId = process.argv[2];
if (process.argv.length > 3) {
  fail("Usage: pnpm migrations:finalize [migration-id]");
} else {
  try {
    const { file, lock, entries } = lockState();
    const drafts = entries.filter((entry) => entry.stage === "draft");
    const entry = requestedId
      ? entries.find((candidate) => candidate.id === requestedId)
      : drafts.at(-1);
    if (!entry)
      throw new Error(
        requestedId
          ? `unknown migration ${requestedId}`
          : "no draft migration to finalize",
      );
    if (entry.stage !== "draft")
      throw new Error(`${entry.id} is already ${entry.stage}`);
    if (!requestedId && drafts.length > 1)
      throw new Error(
        `multiple draft migrations exist; choose one: ${drafts.map(({ id }) => id).join(", ")}`,
      );
    formatStep(entry.id);
    setChecksum(entry);
    entry.stage = "final";
    writeJson(file, lock);
    console.log(`Finalized migration ${entry.id} (${entry.checksum})`);
    console.log(
      "The step is now immutable; fix future problems with a new migration.",
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
