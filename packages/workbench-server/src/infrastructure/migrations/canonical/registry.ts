import { canonicalMigration0003 } from "./0003-normalize-canonical-data.js";
import type { CanonicalMigration } from "./definition.js";

export const canonicalMigrationRegistry: readonly CanonicalMigration[] = [
  canonicalMigration0003,
];
