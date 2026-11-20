import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  permissionOverlayDocumentForOriginSchema,
  permissionRuleSetSchema,
} from "@nervekit/contracts/permissions";
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
import { overlayDigest } from "../permissions/permission-overlays.js";
import { projectPermissionValue } from "../permissions/project-permission-migrations.js";
import type { ScopedPermissionPolicySource } from "../permissions/scoped-permission-source.js";

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
  const at = issue.pointer ? `${issue.pointer}: ` : "";
  const meaning = EXPLANATIONS[issue.code];
  if (!meaning) return `${at}${issue.message ?? issue.code}`;
  return `${at}${meaning}${issue.message ? ` Detail: ${issue.message}` : ""}`;
}

/** One line naming the first problem of a document, bounded. */
function describe(error: unknown): string {
  const issue =
    typeof error === "object" && error !== null && "issues" in error
      ? (error as { issues: { path: PropertyKey[]; message: string }[] })
          .issues[0]
      : undefined;
  const text = issue
    ? `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`
    : error instanceof Error
      ? error.message
      : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * The `configuration.*` quick_script namespace for one project: re-reads the files an agent edited
 * by hand and reports what is still wrong. It writes no file and never grants trust.
 */
export function createConfigurationAgentPort(options: {
  service: AgentConfigurationService;
  policy: Pick<ScopedPermissionPolicySource, "reload">;
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
      message: untrusted ? UNTRUSTED : explain(issue),
      ...(untrusted ? { trust: "untrusted" as const } : {}),
    };
  }

  function overlayApproved(path: string, content: string): boolean {
    const row = options.trustedResources.find(
      "project_permissions",
      projectId,
      path,
    );
    return (
      row?.status === "trusted" && row.contentDigest === overlayDigest(content)
    );
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

  async function permissionDiagnostics(
    scope: ConfigurationAgentScope,
  ): Promise<ConfigurationAgentDiagnostic[]> {
    const found: ConfigurationAgentDiagnostic[] = [];
    const file = overlayPath(scope);
    let content: string | undefined;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        found.push({
          scope,
          document: "permissions.json",
          path: file,
          message: describe(error),
        });
    }
    if (content !== undefined) {
      try {
        const value: unknown = JSON.parse(content);
        if (scope === "project") projectPermissionValue(value);
        else permissionOverlayDocumentForOriginSchema("user").parse(value);
      } catch (error) {
        found.push({
          scope,
          document: "permissions.json",
          path: file,
          message: describe(error),
        });
      }
      if (scope === "project" && !overlayApproved(file, content))
        found.push({
          scope,
          document: "permissions.json",
          path: file,
          message: UNTRUSTED,
          trust: "untrusted",
        });
    }
    if (scope === "user") {
      const directory = join(home, "config", "rule-sets");
      const names = await readdir(directory).catch(() => [] as string[]);
      for (const name of names
        .filter((entry) => entry.endsWith(".json"))
        .sort()) {
        const path = join(directory, name);
        try {
          permissionRuleSetSchema.parse(
            JSON.parse(await readFile(path, "utf8")),
          );
        } catch (error) {
          found.push({
            scope,
            document: `rule-set:${name.slice(0, -5)}`,
            path,
            message: describe(error),
          });
        }
      }
    }
    return found;
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
        message: `Invalid (${problem.reason}). Until it is fixed, the project has no launch definitions.`,
      },
    ];
  }

  async function status(scope: ConfigurationAgentScope) {
    return {
      diagnostics: [
        ...(await agentDiagnostics(scope)).map(convert),
        ...(await permissionDiagnostics(scope)),
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
      // The user scope also covers every rule set, so one call drops all cached policy files.
      await policy.reload(scope === "user" ? undefined : [overlayPath(scope)]);
      return await status(scope);
    },
    status,
  };
}
