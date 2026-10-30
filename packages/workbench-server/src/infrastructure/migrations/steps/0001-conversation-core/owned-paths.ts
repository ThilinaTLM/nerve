/**
 * Frozen ownership from v0.34.1:
 * infrastructure/storage-bootstrap/paths.ts owns the six home documents;
 * Canonical output documents are included only to avoid overwriting collisions.
 */
export const HOME_CONFIGURATION_FILES = [
  "daemon.json",
  "harness.json",
  "ui.json",
  "permissions.json",
  "providers.json",
  "integrations.json",
  "prompt-suggestions.json",
  "subagents.json",
] as const;
