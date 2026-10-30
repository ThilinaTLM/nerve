import { z } from "zod";
import {
  permissionOverlayDocumentForOriginSchema,
  type PermissionOverlayDocument,
} from "@nervekit/contracts/permissions";
import type { ProjectConfigurationType } from "../infrastructure/configuration/project-migration/project-migration.js";
import { convertDocument } from "../infrastructure/configuration/agent-configuration/project-chains/frozen/policy-document.js";
export type ProjectPermissionDocument = PermissionOverlayDocument & {
  version: 2;
};
export const projectPermissionSchema = {
  parse(value: unknown): ProjectPermissionDocument {
    const { version, ...document } = z
      .object({ version: z.literal(2) })
      .passthrough()
      .parse(value);
    const parsed =
      permissionOverlayDocumentForOriginSchema("project").parse(document);
    if (
      parsed.overlays.some((overlay) =>
        overlay.rules.some((rule) =>
          rule.when?.toolNames?.includes("plan_mode_present"),
        ),
      )
    )
      throw new Error(
        "Deprecated planning selector in current permission overlay",
      );
    return { ...parsed, version };
  },
};
export function projectPermissionValue(
  value: unknown,
): PermissionOverlayDocument {
  const document: Partial<ProjectPermissionDocument> = {
    ...projectPermissionSchema.parse(value),
  };
  delete document.version;
  return permissionOverlayDocumentForOriginSchema("project").parse(document);
}
export const projectPermissionsConfiguration: ProjectConfigurationType<ProjectPermissionDocument> =
  {
    id: "permission-overlay",
    label: "Project permissions",
    resetDescription:
      "Remove this overlay that is blocking tool execution; user-level policy will apply. Model-only replies remain available.",
    fallbackDescription:
      "Tool execution is blocked in this project until the overlay is fixed or reset. Model-only replies remain available.",
    path: "config/permissions.json",
    currentVersion: 2,
    version: { field: "version", absent: 1 },
    migrators: {
      1: (value) => {
        const document = { ...(value as Record<string, unknown>) };
        delete document.version;
        return {
          ...(convertDocument(document, "permissions") as object),
          version: 2,
        };
      },
    },
    schema: projectPermissionSchema,
    fallback: () => ({ schemaVersion: 2, version: 2, overlays: [] }),
    reset: () => null,
    trustKind: "project_permissions",
  };
