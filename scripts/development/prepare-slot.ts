import { resolveStorageSlot } from "./storage-slot.mjs";
import { prepareDevelopmentSlot } from "./storage-preparation.js";

try {
  const slot = resolveStorageSlot(process.argv.slice(2));
  await prepareDevelopmentSlot(slot);
  console.log(`[nerve] Prepared development home: ${slot.home}`);
} catch (error) {
  console.error(
    `[nerve] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
