import type { TrustedResourceKind } from "@nervekit/contracts/core";
import {
  captureTrust,
  revokeTrust,
  type TrustStorage,
} from "../trusted-write.js";
import type { ProjectMigrationTrust } from "./project-migration.js";

/**
 * Carries an exact-byte approval to bytes Nerve writes to the same file on the user's behalf (see
 * `captureTrust`), looking the trust kind up from the configuration type.
 */
export function projectMigrationTrust(
  getStorage: TrustStorage,
  kinds: Readonly<Record<string, TrustedResourceKind>>,
): ProjectMigrationTrust {
  const kindOf = (type: string) => kinds[type] ?? kinds[type.split(":")[0]];
  return {
    async revoke({ type, projectId, paths }) {
      const kind = kindOf(type);
      if (kind) revokeTrust(getStorage, { kind, projectId, paths });
    },
    async capture({ type, projectId, path, source }) {
      const kind = kindOf(type);
      return kind
        ? captureTrust(getStorage, { kind, projectId, path, source })
        : undefined;
    },
  };
}
