import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  inspectWorkbenchHome,
  WORKBENCH_STATE_FORMAT,
  WORKBENCH_STATE_VERSION,
} from "../../storage/state-layout.js";
import { writeTextFileIfMissing } from "../../storage/json.js";
import type { StorageMigration } from "../migration.js";
import { migrationChecksum } from "../checksum.js";

export const migration0001: StorageMigration = {
  id: "0001-v2-storage-baseline",
  description: "Establish the version 2 workbench storage layout",
  checksum: migrationChecksum(
    "0001-v2-storage-baseline|v2|Establish the version 2 workbench storage layout",
  ),
  async detect(context) {
    const inspection = await inspectWorkbenchHome(context.paths.home);
    if (inspection.kind === "current") return "current";
    if (
      inspection.kind === "missing" ||
      inspection.kind === "empty" ||
      inspection.kind === "desktop-bootstrap" ||
      inspection.kind === "legacy"
    )
      return "pending";
    throw new Error(
      `Cannot migrate incompatible Nerve home: ${"reason" in inspection ? inspection.reason : inspection.kind}`,
    );
  },
  async backup() {
    return { paths: ["VERSION"] };
  },
  async up(context) {
    await mkdir(context.paths.home, { recursive: true, mode: 0o700 });
    await writeTextFileIfMissing(
      join(context.paths.home, "VERSION"),
      `${JSON.stringify({ format: WORKBENCH_STATE_FORMAT, version: WORKBENCH_STATE_VERSION }, null, 2)}\n`,
      0o600,
    );
  },
  async verify(context) {
    if ((await inspectWorkbenchHome(context.paths.home)).kind !== "current") {
      throw new Error("Version 2 storage marker was not established.");
    }
  },
};
