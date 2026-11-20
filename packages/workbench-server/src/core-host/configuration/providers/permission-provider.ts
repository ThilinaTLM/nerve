import { join } from "node:path";
import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import type { CoreStorage } from "@nervekit/conversation-core";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";
import type { PermissionFileReport } from "../../permissions/permission-files.js";
import type { ScopedPermissionPolicySource } from "../../permissions/scoped-permission-source.js";
import {
  resourcesFromFindings,
  type ConfigurationResourceProvider,
  type ResourceContext,
  type ResourceFinding,
} from "../resource-registry.js";
import {
  TRUST_PAGE,
  explainDiagnostic,
} from "./agent-configuration-provider.js";

const builtinIds = new Set(builtInPermissionRuleSets.map((entry) => entry.id));

/** Rule sets and permission overlays. The permission source validates; this words its reports. */
export function permissionProvider(options: {
  policy: Pick<ScopedPermissionPolicySource, "check" | "reload" | "loaded">;
  trustedResources: Pick<CoreStorage["trustedResources"], "find">;
}): ConfigurationResourceProvider {
  /** The user scope is the user overlay plus every rule set; a project has its overlay. */
  const paths = (context: ResourceContext) =>
    context.scope === "user"
      ? undefined
      : [
          join(
            context.projectDirectory ?? "",
            ".nerve",
            "config",
            "permissions.json",
          ),
        ];

  function resources(
    context: ResourceContext,
    reports: readonly PermissionFileReport[],
    all: boolean,
  ): ConfigurationResource[] {
    const found = reports
      .filter(
        (report) =>
          report.scope === context.scope &&
          (all ? report.exists : true) &&
          (all || report.diagnostics.length > 0 || approvalOf(report)),
      )
      .flatMap((report): ConfigurationResource[] => {
        const at = {
          kind: report.kind,
          id:
            report.kind === "rule-set"
              ? report.document === "rule-sets"
                ? "(folder)"
                : report.document.slice("rule-set:".length)
              : report.document,
          scope: report.scope,
          path: report.path,
        } satisfies ResourceFinding;
        const approval = approvalOf(report);
        const [resource] = resourcesFromFindings([
          { ...at, ...(approval ? { approval } : {}) },
          ...report.diagnostics.map(
            (diagnostic): ResourceFinding => ({
              ...at,
              ...(report.previousVersionActive
                ? { previousVersionActive: true }
                : {}),
              diagnostic:
                diagnostic.level === "error"
                  ? {
                      ...diagnostic,
                      message: explainDiagnostic(
                        diagnostic.code,
                        diagnostic.message,
                      ),
                    }
                  : diagnostic,
            }),
          ),
        ]);
        if (resource.state !== "active" || !report.ruleSet) return [resource];
        if (builtinIds.has(report.ruleSet.id))
          return [{ ...resource, state: "shadowed", shadowedBy: "builtin" }];
        return [
          report.ruleSet.enabled
            ? resource
            : { ...resource, state: "disabled" },
        ];
      });
    return found;

    function approvalOf(report: PermissionFileReport) {
      if (report.scope !== "project" || !report.contentDigest) return undefined;
      const row = options.trustedResources.find(
        "project_permissions",
        context.projectId ?? null,
        report.path,
      );
      return row?.status === "trusted" &&
        row.contentDigest === report.contentDigest
        ? undefined
        : ({ kind: "trust", where: TRUST_PAGE } as const);
    }
  }

  return {
    kinds: ["rule-set", "permission-overlay"],
    async list(context) {
      return [
        ...(context.scope === "user"
          ? builtInPermissionRuleSets.map(
              (entry): ConfigurationResource => ({
                kind: "rule-set",
                id: entry.id,
                scope: "builtin",
                state: "active",
                diagnostics: [],
              }),
            )
          : []),
        ...resources(
          context,
          await options.policy.loaded(paths(context)),
          true,
        ),
      ];
    },
    check: async (context) =>
      resources(context, await options.policy.check(paths(context)), false),
    // The user scope also re-reads every permission file loaded so far.
    reload: async (context) =>
      resources(context, await options.policy.reload(paths(context)), false),
  };
}
