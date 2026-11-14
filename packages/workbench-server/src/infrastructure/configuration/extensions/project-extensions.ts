import {
  emptyExtensionsDocument,
  extensionsDocumentSchema,
  type ExtensionsDocument,
} from "@nervekit/contracts/extensions";
import type { ProjectConfigurationType } from "../project-migration/project-migration.js";

/**
 * Project extension settings. Chain v1 of `config/extensions.json`; the
 * envelope `schemaVersion` is also the chain version. Trusted by exact
 * content, like the project agent file.
 */
export const projectExtensionsConfiguration: ProjectConfigurationType<ExtensionsDocument> =
  {
    id: "extensions",
    label: "Project extensions",
    resetDescription:
      "Remove this override file; user extension settings will apply.",
    fallbackDescription:
      "User extension settings apply while this override is unavailable.",
    path: "config/extensions.json",
    currentVersion: 1,
    version: { field: "schemaVersion", absent: 1 },
    migrators: {},
    schema: extensionsDocumentSchema,
    fallback: emptyExtensionsDocument,
    reset: () => null,
  };
