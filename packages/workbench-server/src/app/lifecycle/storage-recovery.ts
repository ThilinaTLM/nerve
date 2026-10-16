import type { ServerLifecycleFailure } from "@nervekit/contracts/status";
import { resetHomeConfigurationDocuments } from "../../infrastructure/configuration/home-configuration.js";
import {
  discardFailedItems,
  rollbackFailedMigration,
} from "../../infrastructure/migrations/framework/recovery.js";
import { storagePaths } from "../../infrastructure/storage-bootstrap/paths.js";
import type { LifecycleControls } from "./lifecycle-routes.js";
import type { StartupSequence } from "./startup-sequence.js";
import { CONFIGURATION_INVALID } from "./storage-failure.js";

/**
 * Retry (optionally discarding the failure's units first) and rollback for
 * `home`. Invalid user configuration is reset to defaults; migration units are
 * recorded for the next upgrade attempt.
 */
export function storageRecoveryControls(
  home: string,
  sequence: () => StartupSequence,
  failure: () => ServerLifecycleFailure | undefined,
): Pick<LifecycleControls, "retry" | "rollback"> {
  return {
    retry: (discard) => {
      if (!discard) return sequence().retry();
      const code = failure()?.code;
      return sequence().retry(() =>
        code === CONFIGURATION_INVALID
          ? resetHomeConfigurationDocuments(storagePaths(home), discard)
          : discardFailedItems(home, discard),
      );
    },
    rollback: () => sequence().rollback(() => rollbackFailedMigration(home)),
  };
}
