import { join } from "node:path";
import type {
  ConfigurationAgentDiagnostic,
  ConfigurationAgentPort,
  ConfigurationAgentScope,
} from "@nervekit/tools/quick-script";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ConfigurationDiagnostic,
  PreferenceScope,
} from "../../infrastructure/configuration/agent-configuration/document-adapters.js";
import type { PermissionFileReport } from "../permissions/permission-files.js";
import type { ScopedPermissionPolicySource } from "../permissions/scoped-permission-source.js";

const PREVIOUS_ACTIVE =
  "The version loaded before this edit stays in use until the file is fixed and reloaded.";
const UNTRUSTED =
  "Ignored until the user approves its exact content in Settings → This project → Trust.";

/** What a diagnostic code means and what to do next; `issue.message` adds the parser's detail. */
const EXPLANATIONS: Record<string, string> = {
  "malformed-json":
    "Not valid JSON, so the whole file is ignored. Fix the syntax.",
  "invalid-value":
    "Invalid value. Correct it against the file's JSON Schema in the configure-nerve skill.",
  "unknown-field":
    "Unknown field; unknown keys are rejected. Remove it or correct its name.",
  "future-version":
    "Written by a newer Nerve version, which this version cannot read. Leave the file as it is and tell the user to upgrade Nerve.",
  "io-error":
    "Could not be read. Check that it exists and is readable by the user running Nerve.",
  "legacy-conversion-required":
    "Uses an older format that could not be converted automatically. Leave the file as it is; the user can repair it in Settings.",
};

function explain(issue: ConfigurationDiagnostic): string {
  const meaning = EXPLANATIONS[issue.code];
  if (!meaning) return issue.message ?? issue.code;
  return `${meaning}${issue.message ? ` Detail: ${issue.message}` : ""}`;
}

/**
 * The `configuration.*` quick_script namespace for one project: re-reads the files an agent edited
 * by hand and reports what is still wrong. It writes no file and never grants trust.
 */
export function createConfigurationAgentPort(options: {
  service: AgentConfigurationService;
  policy: Pick<ScopedPermissionPolicySource, "reload" | "check">;
  home: string;
  /** The conversation whose project the scope `"project"` names. */
  conversationId: string;
  trustedResources: Pick<CoreStorage["trustedResources"], "find">;
  launchDefinitions: Pick<LaunchDefinitionService, "problem">;
}): ConfigurationAgentPort {
  const { service, policy, home } = options;
  const projectId = service.paths.locations.conversationOwner(
    options.conversationId,
  ).projectId;
  const preference = (scope: ConfigurationAgentScope): PreferenceScope =>
    scope === "user" ? { scope } : { scope, projectId };
  const overlayPath = (scope: ConfigurationAgentScope) =>
    scope === "user"
      ? join(home, "config", "permissions.json")
      : join(
          service.paths.locations.projectDirectory(projectId) ?? "",
          ".nerve",
          "config",
          "permissions.json",
        );

  function convert(
    issue: ConfigurationDiagnostic,
  ): ConfigurationAgentDiagnostic {
    const untrusted = issue.code === "untrusted";
    return {
      scope: issue.scope as ConfigurationAgentScope,
      document: issue.document === "agent" ? "agent.json" : issue.document,
      path: issue.path,
      level: untrusted ? "warning" : "error",
      code: issue.code,
      message: untrusted ? UNTRUSTED : explain(issue),
      ...(issue.pointer ? { pointer: issue.pointer } : {}),
    };
  }

  async function agentDiagnostics(
    scope: ConfigurationAgentScope,
  ): Promise<ConfigurationDiagnostic[]> {
    const target = preference(scope);
    const state = await service.ensureLoaded(target);
    await service.loadCreation(target);
    // Listing loads every profile file of the scope, so its problems enter `health()`. The editing
    // listing reports file and trust problems only: whether a profile suits a lead or a sub-agent
    // depends on where it is used, not on the file.
    const listing = await service.profiles.listForEditing(target);
    const issues = [
      ...service.health(),
      ...listing.diagnostics,
      ...listing.profiles.flatMap((entry) => entry.diagnostics),
      ...(service.untrustedProject(state)
        ? [
            {
              scope: "project",
              scopeId: projectId,
              document: "agent",
              path: service.paths.agent(target),
              code: "untrusted",
              pointer: "",
              affectedCapability: "agent-execution",
              recoveryChoices: [],
            } satisfies ConfigurationDiagnostic,
          ]
        : []),
    ];
    const seen = new Set<string>();
    return issues.filter((issue) => {
      const key = JSON.stringify([
        issue.document,
        issue.path,
        issue.code,
        issue.pointer,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return (
        issue.scope === scope &&
        (scope === "user" || issue.scopeId === projectId)
      );
    });
  }

  /** Reports of the permission source, which owns the validation of these files. */
  function permissionDiagnostics(
    scope: ConfigurationAgentScope,
    reports: readonly PermissionFileReport[],
  ): ConfigurationAgentDiagnostic[] {
    return reports
      .filter((report) => report.scope === scope)
      .flatMap((report) => {
        const at = {
          scope,
          document: report.document,
          path: report.path,
        };
        const found = report.diagnostics.map(
          (diagnostic): ConfigurationAgentDiagnostic => ({
            ...at,
            ...diagnostic,
            message: report.previousVersionActive
              ? `${diagnostic.message} ${PREVIOUS_ACTIVE}`
              : diagnostic.message,
          }),
        );
        const row =
          scope === "project" && report.contentDigest
            ? options.trustedResources.find(
                "project_permissions",
                projectId,
                report.path,
              )
            : undefined;
        if (
          scope === "project" &&
          report.contentDigest &&
          !(
            row?.status === "trusted" &&
            row.contentDigest === report.contentDigest
          )
        )
          found.push({
            ...at,
            level: "warning",
            code: "untrusted",
            message: UNTRUSTED,
          });
        return found;
      });
  }

  async function launchDiagnostics(
    scope: ConfigurationAgentScope,
  ): Promise<ConfigurationAgentDiagnostic[]> {
    if (scope !== "project") return [];
    const problem = await options.launchDefinitions.problem(projectId);
    if (!problem) return [];
    return [
      {
        scope,
        document: "launches",
        path: problem.path,
        level: "error",
        code: "invalid-value",
        message: `Invalid (${problem.reason}). Until it is fixed, the project has no launch definitions.`,
      },
    ];
  }

  const permissionPaths = (scope: ConfigurationAgentScope) =>
    scope === "user" ? undefined : [overlayPath(scope)];

  async function result(
    scope: ConfigurationAgentScope,
    reports: readonly PermissionFileReport[],
  ) {
    return {
      diagnostics: [
        ...(await agentDiagnostics(scope)).map(convert),
        ...permissionDiagnostics(scope, reports),
        ...(await launchDiagnostics(scope)),
      ],
    };
  }

  return {
    async reload(scope) {
      const target = preference(scope);
      await service.reload(target);
      await service.reloadCreation(target);
      await service.profiles.reloadCatalog(target);
      // The user scope also covers every rule set and every file loaded so far.
      return await result(scope, await policy.reload(permissionPaths(scope)));
    },
    status: async (scope) =>
      await result(scope, await policy.check(permissionPaths(scope))),
  };
}
