import type { LegacyLifecycleAuthorityFact } from "../../migrations/unified-timeline/legacy-authority-retirement-database.js";
import type { CanonicalCommand } from "./worker-protocol.js";

export class CanonicalMigrationStore {
  constructor(
    private readonly request: <T>(command: CanonicalCommand) => Promise<T>,
  ) {}

  countLegacyRuntimeAuthority() {
    return this.request<number>({ kind: "count_legacy_runtime_authority" });
  }

  readLegacyLifecycleAuthorityFacts() {
    return this.request<LegacyLifecycleAuthorityFact[]>({
      kind: "read_legacy_lifecycle_authority_facts",
    });
  }

  retireLegacyRuntimeAuthority() {
    return this.request<number>({ kind: "retire_legacy_runtime_authority" });
  }
}
