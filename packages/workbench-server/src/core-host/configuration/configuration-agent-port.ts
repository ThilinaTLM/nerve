import { join } from "node:path";
import type {
  ConfigurationResource,
  Diagnostic,
} from "@nervekit/contracts/configuration";
import type {
  ConfigurationAgentPort,
  ConfigurationAgentResult,
  ConfigurationAgentScope,
} from "@nervekit/tools/quick-script";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ConfigurationDiagnostic,
  PreferenceScope,
} from "../../infrastructure/configuration/agent-configuration/document-adapters.js";
import {
  inspectScope,
  reloadScopeKeepingLoaded,
} from "../../infrastructure/configuration/agent-configuration/hand-edits.js";
import type { PermissionFileReport } from "../permissions/permission-files.js";
import type { ScopedPermissionPolicySource } from "../permissions/scoped-permission-source.js";

const TRUST_PAGE = "Settings → This project → Trust";
const UNTRUSTED = `Valid, but ignored until the user approves its exact content in ${TRUST_PAGE}. You cannot approve it; tell the user.`;

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

function explain(code: string, detail: string | undefined): string {
  const meaning = EXPLANATIONS[code];
  if (!meaning) return detail ?? code;
  return detail && !meaning.includes(detail)
    ? `${meaning} Detail: ${detail}`
    : meaning;
}

/** One file's problems before they are grouped into a resource. */
type Finding = Pick<ConfigurationResource, "kind" | "id" | "path"> & {
  diagnostic?: Diagnostic;
  untrusted?: true;
  previousVersionActive?: true;
};

/** `agent`, `conversation-defaults`, `profile:<name>`, `permissions.json`, `rule-set:<id>`, `rule-sets`. */
function identify(
  document: string,
): Pick<ConfigurationResource, "kind" | "id"> {
  if (document.startsWith("profile:"))
    return { kind: "agent-profile", id: document.slice("profile:".length) };
  if (document.startsWith("rule-set:"))
    return { kind: "rule-set", id: document.slice("rule-set:".length) };
  if (document === "rule-sets") return { kind: "rule-set", id: "(folder)" };
  if (document === "agent")
    return { kind: "agent-preferences", id: "agent.json" };
  if (document === "conversation-defaults")
    return { kind: "agent-preferences", id: "conversation-defaults.json" };
  return { kind: "permission-overlay", id: document };
}

/**
 * The `configuration.*` quick_script namespace for one project: validates the files an agent edited
 * by hand, activates the valid ones and reports what is still wrong. It writes no file and never
 * grants trust. Each owner validates its own files; this port only gathers and words the results.
 */
export function createConfigurationAgentPort(options: {
  service: AgentConfigurationService;
  policy: Pick<ScopedPermissionPolicySource, "reload" | "check">;
  /** The conversation whose project the scope `"project"` names. */
  conversationId: string;
  trustedResources: Pick<CoreStorage["trustedResources"], "find">;
  launchDefinitions: Pick<LaunchDefinitionService, "problem">;
}): ConfigurationAgentPort {
  const { service, policy } = options;
  const projectId = service.paths.locations.conversationOwner(
    options.conversationId,
  ).projectId;
  const preference = (scope: ConfigurationAgentScope): PreferenceScope =>
    scope === "user" ? { scope } : { scope, projectId };
  const permissionPaths = (scope: ConfigurationAgentScope) =>
    scope === "user"
      ? undefined
      : [
          join(
            service.paths.locations.projectDirectory(projectId) ?? "",
            ".nerve",
            "config",
            "permissions.json",
          ),
        ];

  /** Only this scope's own files; a project scope also loads the user's. */
  const own =
    (scope: ConfigurationAgentScope) => (issue: ConfigurationDiagnostic) =>
      issue.scope === scope &&
      (scope === "user" || issue.scopeId === projectId);

  function fromAgentConfiguration(
    issue: ConfigurationDiagnostic,
    previousVersionActive: boolean,
  ): Finding {
    const at = { ...identify(issue.document), path: issue.path };
    if (issue.code === "untrusted") return { ...at, untrusted: true };
    return {
      ...at,
      ...(previousVersionActive ? { previousVersionActive: true } : {}),
      diagnostic: {
        level: "error",
        code: issue.code,
        message: explain(issue.code, issue.message),
        ...(issue.pointer ? { pointer: issue.pointer } : {}),
      },
    };
  }

  function fromPermissions(
    scope: ConfigurationAgentScope,
    reports: readonly PermissionFileReport[],
  ): Finding[] {
    return reports
      .filter((report) => report.scope === scope)
      .flatMap((report) => {
        const at = { ...identify(report.document), path: report.path };
        const found = report.diagnostics.map(
          (diagnostic): Finding => ({
            ...at,
            ...(report.previousVersionActive
              ? { previousVersionActive: true }
              : {}),
            diagnostic: {
              ...diagnostic,
              message: explain(diagnostic.code, diagnostic.message),
            },
          }),
        );
        if (scope !== "project" || !report.contentDigest) return found;
        const row = options.trustedResources.find(
          "project_permissions",
          projectId,
          report.path,
        );
        return row?.status === "trusted" &&
          row.contentDigest === report.contentDigest
          ? found
          : [...found, { ...at, untrusted: true as const }];
      });
  }

  async function fromLaunches(
    scope: ConfigurationAgentScope,
  ): Promise<Finding[]> {
    if (scope !== "project") return [];
    const problem = await options.launchDefinitions.problem(projectId);
    if (!problem) return [];
    return [
      {
        kind: "launch-catalog",
        id: "definitions.json",
        path: problem.path,
        diagnostic: {
          level: "error",
          code: "invalid-value",
          message: `Invalid (${problem.reason}). Until it is fixed, the project has no launch definitions.`,
        },
      },
    ];
  }

  /** One resource per file, with a state the agent can act on. */
  function resources(
    scope: ConfigurationAgentScope,
    findings: readonly Finding[],
  ): ConfigurationAgentResult {
    const byFile = new Map<string, ConfigurationResource>();
    const seen = new Set<string>();
    for (const finding of findings) {
      const key = `${finding.kind}\0${finding.id}\0${finding.path ?? ""}`;
      const resource =
        byFile.get(key) ??
        ({
          kind: finding.kind,
          id: finding.id,
          scope,
          ...(finding.path ? { path: finding.path } : {}),
          state: "active",
          diagnostics: [],
        } satisfies ConfigurationResource);
      byFile.set(key, resource);
      if (finding.previousVersionActive) resource.previousVersionActive = true;
      if (finding.untrusted) {
        resource.approval = { kind: "trust", where: TRUST_PAGE };
        resource.diagnostics.push({
          level: "warning",
          code: "untrusted",
          message: UNTRUSTED,
        });
      }
      const diagnostic = finding.diagnostic;
      if (!diagnostic) continue;
      const identity = `${key}\0${diagnostic.code}\0${diagnostic.pointer ?? ""}\0${diagnostic.message}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      resource.diagnostics.push(diagnostic);
    }
    for (const resource of byFile.values()) {
      const broken = resource.diagnostics.some(
        (diagnostic) => diagnostic.level === "error",
      );
      // A kept previous version is what is in effect, so the resource stays active.
      if (broken && !resource.previousVersionActive) resource.state = "invalid";
      else if (!broken && resource.approval) resource.state = "needs_approval";
    }
    return { resources: [...byFile.values()] };
  }

  /** What is loaded now: every profile file of the scope enters `health()` through the listing. */
  async function loaded(
    scope: ConfigurationAgentScope,
  ): Promise<ConfigurationDiagnostic[]> {
    const target = preference(scope);
    const state = await service.ensureLoaded(target);
    await service.loadCreation(target);
    // The editing listing reports file and trust problems only: whether a profile suits a lead
    // or a sub-agent depends on where it is used, not on the file.
    const listing = await service.profiles.listForEditing(target);
    return [
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
    ].filter(own(scope));
  }

  return {
    async check(scope) {
      const target = preference(scope);
      const state = await service.ensureLoaded(target);
      return resources(scope, [
        ...(await inspectScope(service, target))
          .filter(own(scope))
          .map((issue) => fromAgentConfiguration(issue, false)),
        ...(service.untrustedProject(state)
          ? [
              {
                ...identify("agent"),
                path: service.paths.agent(target),
                untrusted: true as const,
              },
            ]
          : []),
        ...fromPermissions(scope, await policy.check(permissionPaths(scope))),
        ...(await fromLaunches(scope)),
      ]);
    },
    async reload(scope) {
      const kept = await reloadScopeKeepingLoaded(service, preference(scope));
      // The user scope also covers every rule set and every permission file loaded so far.
      const reports = await policy.reload(permissionPaths(scope));
      return resources(scope, [
        ...kept
          .filter(own(scope))
          .map((issue) => fromAgentConfiguration(issue, true)),
        ...(await loaded(scope)).map((issue) =>
          fromAgentConfiguration(issue, false),
        ),
        ...fromPermissions(scope, reports),
        ...(await fromLaunches(scope)),
      ]);
    },
  };
}
