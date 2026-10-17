import {
  discardFailedItems,
  rollbackFailedMigration,
} from "../../infrastructure/migrations/framework/recovery.js";
import type { LifecycleControls } from "./lifecycle-routes.js";
import type { StartupSequence } from "./startup-sequence.js";

/** Retry or roll back migration failures. Runtime settings never block startup. */
export function storageRecoveryControls(
  home: string,
  sequence: () => StartupSequence,
): Pick<LifecycleControls, "retry" | "rollback"> {
  return {
    retry: (discard) => {
      if (!discard) return sequence().retry();
      return sequence().retry(() => discardFailedItems(home, discard));
    },
    rollback: () => sequence().rollback(() => rollbackFailedMigration(home)),
  };
}
