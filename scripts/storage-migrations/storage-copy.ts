import {
  assertSlotPaths,
  createSlotParent,
} from "../development/storage-slot.mjs";
import { cloneNerveHome } from "./home-operations.js";
import { resolveStorageCopyOptions } from "./storage-copy-options.js";

try {
  const { source, slot } = resolveStorageCopyOptions(process.argv.slice(2));
  await createSlotParent(slot);
  console.log(`Copying stopped Nerve home ${source} to ${slot.home}`);
  await cloneNerveHome({ source, destination: slot.home });
  await assertSlotPaths(slot);
  console.log(
    `Created disposable storage slot ${slot.slot}. Start pnpm desktop:dev --slot ${slot.slot} or pnpm dev --slot ${slot.slot}.`,
  );
  console.warn(
    "Copied credentials and project paths can still access real providers and files; this is storage isolation, not a sandbox.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
