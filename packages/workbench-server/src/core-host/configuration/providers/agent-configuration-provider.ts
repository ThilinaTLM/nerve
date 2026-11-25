import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ConfigurationDiagnostic,
  PreferenceScope,
} from "../../../infrastructure/configuration/agent-configuration/document-adapters.js";
import {
  inspectScope,
  reloadScopeKeepingLoaded,
} from "../../../infrastructure/configuration/agent-configuration/hand-edits.js";
import {
  projectOf,
  resourcesFromFindings,
  type ConfigurationResourceProvider,
  type ResourceContext,
  type ResourceFinding,
} from "../resource-registry.js";

/** Where the user decides each project file; the decision is made on the page of the resource. */
export const AGENT_TRUST_PAGE = "Project settings → General";
export const PERMISSIONS_TRUST_PAGE = "Project settings → Permission rules";
export const PROFILE_TRUST_PAGE = "Project settings → Agents or Sub-Agents";
const trustAt = (where: string) => ({ kind: "trust", where }) as const;

/** What a diagnostic code means and what to do next; the parser's detail is appended. */
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

export function explainDiagnostic(
  code: string,
  detail: string | undefined,
): string {
  const meaning = EXPLANATIONS[code];
  if (!meaning) return detail ?? code;
  return detail && !meaning.includes(detail)
    ? `${meaning} Detail: ${detail}`
    : meaning;
}

function identify(
  document: string,
): Pick<ConfigurationResource, "kind" | "id"> {
  if (document.startsWith("profile:"))
    return { kind: "agent-profile", id: document.slice("profile:".length) };
  return {
    kind: "agent-preferences",
    id: document === "agent" ? "agent.json" : `${document}.json`,
  };
}

/** The located record of agent configuration, as a finding in the shared shape. */
function finding(
  issue: ConfigurationDiagnostic,
  previousVersionActive = false,
): ResourceFinding {
  const at = {
    ...identify(issue.document),
    scope: issue.scope,
    path: issue.path,
  };
  const approval = trustAt(
    issue.document === "agent" ? AGENT_TRUST_PAGE : PROFILE_TRUST_PAGE,
  );
  if (issue.code === "needs-review") return { ...at, approval };
  if (issue.code === "declined") return { ...at, approval, declined: true };
  return {
    ...at,
    ...(previousVersionActive ? { previousVersionActive: true } : {}),
    diagnostic: {
      level: "error",
      code: issue.code,
      message: explainDiagnostic(issue.code, issue.message),
      ...(issue.pointer ? { pointer: issue.pointer } : {}),
    },
  };
}

/** Agent preferences (`agent.json`, conversation defaults) and agent profiles. */
export function agentConfigurationProvider(options: {
  service: AgentConfigurationService;
  /** Ids of the rule sets preferences may select. */
  selectableRuleSetIds(): Promise<string[]>;
}): ConfigurationResourceProvider {
  const { service } = options;
  const target = (context: ResourceContext): PreferenceScope =>
    context.scope === "user"
      ? { scope: "user" }
      : { scope: "project", projectId: projectOf(context) };
  /** Only the scope's own files; a project scope also loads the user's. */
  const own = (context: ResourceContext) => (issue: ConfigurationDiagnostic) =>
    issue.scope === context.scope &&
    (context.scope === "user" || issue.scopeId === context.projectId);
  const untrusted = async (
    context: ResourceContext,
  ): Promise<ResourceFinding[]> => {
    const scope = target(context);
    const state = service.projectTrustState(await service.ensureLoaded(scope));
    return state !== "trusted"
      ? [
          {
            ...identify("agent"),
            scope: "project",
            path: service.paths.agent(scope),
            approval: trustAt(AGENT_TRUST_PAGE),
            ...(state === "declined" ? { declined: true as const } : {}),
          },
        ]
      : [];
  };
  const hand = async () => ({
    ruleSetIds: await options.selectableRuleSetIds(),
  });

  /** A profile that names a missing rule set loads, but blocks every tool call once applied. */
  function unknownRuleSets(
    entry: ProfileCatalogEntry,
    ruleSetIds: readonly string[],
  ): ResourceFinding[] {
    const at = {
      kind: "agent-profile" as const,
      id: entry.name,
      scope: entry.source,
      path: entry.path,
    };
    return (["recommendations", "requirements"] as const).flatMap((section) => {
      const id = entry.definition?.[section]?.permissionRuleSetId;
      return id === undefined || ruleSetIds.includes(id)
        ? []
        : [
            {
              ...at,
              diagnostic: {
                level: "warning" as const,
                code: "unknown-rule-set",
                pointer: `/${section}/permissionRuleSetId`,
                message: `No rule set has the id "${id}", so every tool call of a conversation using this profile is blocked. Available: ${[...ruleSetIds].sort().join(", ")}.`,
              },
            },
          ];
    });
  }

  function profile(
    entry: ProfileCatalogEntry,
    ruleSetIds: readonly string[],
    shadowedBy?: "user" | "project",
  ): ConfigurationResource {
    const [resource] = resourcesFromFindings([
      {
        kind: "agent-profile",
        id: entry.name,
        scope: entry.source,
        ...(entry.source === "builtin" ? {} : { path: entry.path }),
      },
      ...entry.diagnostics.map((issue) => finding(issue)),
      ...unknownRuleSets(entry, ruleSetIds),
    ]);
    if (resource.state !== "active") return resource;
    if (shadowedBy) return { ...resource, state: "shadowed", shadowedBy };
    return entry.enabled ? resource : { ...resource, state: "disabled" };
  }

  async function preferences(
    context: ResourceContext,
  ): Promise<ConfigurationResource[]> {
    const scope = target(context);
    const agent = await service.ensureLoaded(scope);
    const creation = await service.loadCreation(scope);
    const found: ResourceFinding[] = [];
    for (const [document, state, path] of [
      ["agent", agent, service.paths.agent(scope)],
      ["conversation-defaults", creation, service.paths.creation(scope)],
    ] as const) {
      // An absent optional file is not a resource.
      if (state.status === "missing-optional") continue;
      found.push({ ...identify(document), scope: context.scope, path });
    }
    return resourcesFromFindings([
      ...found,
      ...service
        .health()
        .filter(own(context))
        .filter((issue) => !issue.document.startsWith("profile:"))
        .map((issue) => finding(issue)),
      ...(await untrusted(context)),
    ]);
  }

  return {
    kinds: ["agent-preferences", "agent-profile"],
    async list(context) {
      const scope = target(context);
      const listing = await service.profiles.listForEditing(scope);
      const { ruleSetIds } = await hand();
      const stray = resourcesFromFindings(
        listing.diagnostics.filter(own(context)).map((issue) => finding(issue)),
      );
      if (context.scope === "project")
        return [
          ...(await preferences(context)),
          ...listing.profiles
            .filter((entry) => entry.source === "project")
            .map((entry) => profile(entry, ruleSetIds)),
          ...stray,
        ];
      // A project copy hides the user's or the built-in profile of the same name.
      const projectId = context.projectId;
      const inProject = new Set(
        (projectId
          ? await service.profiles.listForEditing({
              scope: "project",
              projectId,
            })
          : { profiles: [] }
        ).profiles
          .filter((entry) => entry.source === "project")
          .map((entry) => entry.name),
      );
      return [
        ...(await preferences(context)),
        ...listing.profiles.flatMap((entry) => [
          profile(
            entry,
            ruleSetIds,
            inProject.has(entry.name) ? "project" : undefined,
          ),
          ...(entry.shadows === "builtin"
            ? [
                {
                  kind: "agent-profile",
                  id: entry.name,
                  scope: "builtin",
                  state: "shadowed",
                  shadowedBy: "user",
                  diagnostics: [],
                } satisfies ConfigurationResource,
              ]
            : []),
        ]),
        ...stray,
      ];
    },
    async check(context) {
      const facts = await hand();
      return resourcesFromFindings([
        ...(await inspectScope(service, target(context), facts))
          .filter(own(context))
          .map((issue) => finding(issue)),
        ...(await profileWarnings(context, facts.ruleSetIds)),
        ...(await untrusted(context)),
      ]);
    },
    async reload(context) {
      const scope = target(context);
      const facts = await hand();
      const { kept, concerns } = await reloadScopeKeepingLoaded(
        service,
        scope,
        facts,
      );
      await service.ensureLoaded(scope);
      await service.loadCreation(scope);
      // Listing loads every profile file of the scope, so its problems enter `health()`. It reports
      // file and trust problems only: whether a profile suits a lead or a sub-agent depends on
      // where it is used, not on the file.
      const listing = await service.profiles.listForEditing(scope);
      return resourcesFromFindings([
        ...kept.filter(own(context)).map((issue) => finding(issue, true)),
        ...concerns.filter(own(context)).map((issue) => finding(issue)),
        ...[
          ...service.health(),
          ...listing.diagnostics,
          ...listing.profiles.flatMap((entry) => entry.diagnostics),
        ]
          .filter(own(context))
          .map((issue) => finding(issue)),
        ...(await profileWarnings(context, facts.ruleSetIds)),
        ...(await untrusted(context)),
      ]);
    },
  };

  async function profileWarnings(
    context: ResourceContext,
    ruleSetIds: readonly string[],
  ): Promise<ResourceFinding[]> {
    const { profiles } = await service.profiles.listForEditing(target(context));
    return profiles
      .filter((entry) => entry.source === context.scope)
      .flatMap((entry) => unknownRuleSets(entry, ruleSetIds));
  }
}
