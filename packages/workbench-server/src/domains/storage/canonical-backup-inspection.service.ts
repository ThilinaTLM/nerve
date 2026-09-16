import { join } from "node:path";
import type { PortableBackupManifest } from "@nervekit/contracts/storage";
import type { StoragePaths } from "../../infrastructure/storage-bootstrap/index.js";
import { CanonicalBackupVerifier } from "./canonical-backup-verifier.js";

/** Admits only backup IDs rooted in the managed backup directory. */
export class CanonicalBackupInspectionService {
  private readonly verifier = new CanonicalBackupVerifier();

  constructor(private readonly paths: StoragePaths) {}

  inspect(backupId: string): Promise<PortableBackupManifest> {
    if (!/^backup_[A-Za-z0-9-]+$/.test(backupId)) {
      throw new Error("Backup ID is invalid.");
    }
    return this.verifier.verify(join(this.paths.backupsPath, backupId));
  }
}
