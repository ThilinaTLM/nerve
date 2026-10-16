/**
 * Frozen ownership from v0.34.1:
 * infrastructure/storage-bootstrap/paths.ts owns the six home documents;
 * infrastructure/configuration/project-configuration.ts reads four project documents;
 * domains/{permissions,capabilities} own their project overlays.
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
export const PROJECT_CONFIGURATION_FILES = [
  "harness.json",
  "ui.json",
  "providers.json",
  "integrations.json",
  "permissions.json",
  "capabilities.json",
  "subagents.json",
] as const;
