import { inspectNerveHome } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/state-layout.js";
import { initializeStorage } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/initialize.js";
import { createSlotParent } from "./storage-slot.mjs";

export async function prepareDevelopmentSlot(slot: {
  repo: string;
  data: string;
  home: string;
  profile: string;
}): Promise<void> {
  await createSlotParent(slot);
  const inspection = await inspectNerveHome(slot.home);
  if (inspection.kind === "unsupported") throw new Error(inspection.reason);
  if (inspection.kind === "current") {
    // Existing-home migrations belong to the daemon/desktop startup workflow,
    // including its approval and draft-recovery handling, not this launcher.
    return;
  }
  const storage = await initializeStorage(slot.home);
  await storage.canonicalStore.close();
}
