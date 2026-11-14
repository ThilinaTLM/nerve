import { z } from "zod";
import {
  permissionOverlayDocumentForOriginSchema,
  type PermissionOverlayDocument,
} from "@nervekit/contracts/permissions";
import type { ProjectConfigurationType } from "../infrastructure/configuration/project-migration/project-migration.js";
import { convertPermissionOverlayV1 } from "../infrastructure/configuration/agent-configuration/project-chains/frozen/policy-document.js";
import { convertPermissionOverlayDocument } from "../infrastructure/migrations/steps/0005-extension-settings/removed-tools.js";
export type ProjectPermissionDocument = PermissionOverlayDocument & {
  version: 3;
};
export const projectPermissionSchema = {
  parse(value: unknown): ProjectPermissionDocument {
    const { version, ...document } = z
      .object({ version: z.literal(3) })
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
    currentVersion: 3,
    version: { field: "version", absent: 1 },
    migrators: {
      1: (value) => {
        const document = { ...(value as Record<string, unknown>) };
        delete document.version;
        return {
          ...(convertPermissionOverlayV1(document) as object),
          version: 2,
        };
      },
      // Rules naming removed direct tools (jira_*, confluence_*, kroki_export, generate_image) become quick_script operation rules; an unconvertible rule is disabled.
      2: (value) => ({
        ...(removedToolRules(value).document as object),
        version: 3,
      }),
    },
    upgradeNotice: (original) => {
      const { changed, reasons } = removedToolRules(original);
      return changed
        ? `Permission rules for the removed Jira, Confluence, diagram and image tools were converted to quick_script operation rules.${
            reasons.length ? ` ${reasons.join(" ")}` : ""
          }`
        : undefined;
    },
    schema: projectPermissionSchema,
    fallback: () => ({ schemaVersion: 2, version: 3, overlays: [] }),
    reset: () => null,
  };

function removedToolRules(value: unknown): {
  document: unknown;
  changed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const { document, changed } = convertPermissionOverlayDocument(
    value,
    (reason) => reasons.push(`${reason}.`),
  );
  return { document, changed, reasons: [...new Set(reasons)] };
}
