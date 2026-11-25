import type {
  ConfigurationResource,
  Diagnostic,
} from "@nervekit/contracts/configuration";

/** Whose resources are asked for: the user's, or those of one project. */
export type ResourceContext = {
  scope: "user" | "project";
  /** The open project; the project scope names it. Absent: user scope with no project open. */
  projectId?: string;
  projectDirectory?: string;
  conversationId?: string;
};

/**
 * The owner of one or more kinds of configurable thing. The registry knows no kind:
 * a new configurable thing becomes visible to the agent and the user by adding a provider.
 */
export interface ConfigurationResourceProvider {
  readonly kinds: readonly ConfigurationResource["kind"][];
  /** What is in effect now, from the owner's loaded state. Built-ins come with the user scope. */
  list(context: ResourceContext): Promise<ConfigurationResource[]>;
  /** Validates the files on disk and changes nothing. Returns the resources that have a diagnostic. */
  check(context: ResourceContext): Promise<ConfigurationResource[]>;
  /** Activates what is valid and keeps the loaded version of what is not. Returns the resources that have a diagnostic. */
  reload(context: ResourceContext): Promise<ConfigurationResource[]>;
}

/** The project a project-scope request names. The registry never asks a provider without one. */
export function projectOf(context: ResourceContext): string {
  if (!context.projectId) throw new Error("No project is open.");
  return context.projectId;
}

export class ConfigurationResourceRegistry {
  readonly #providers: ConfigurationResourceProvider[] = [];

  /** Reload runs in registration order: register what others refer to first (rule sets before preferences). */
  register(provider: ConfigurationResourceProvider): void {
    this.#providers.push(provider);
  }

  list(context: ResourceContext): Promise<ConfigurationResource[]> {
    return this.#each(context, (provider) => provider.list(context));
  }

  check(context: ResourceContext): Promise<ConfigurationResource[]> {
    return this.#each(context, (provider) => provider.check(context));
  }

  reload(context: ResourceContext): Promise<ConfigurationResource[]> {
    return this.#each(context, (provider) => provider.reload(context));
  }

  /** One provider's failure is reported as its own resource; the others still answer. */
  async #each(
    context: ResourceContext,
    run: (
      provider: ConfigurationResourceProvider,
    ) => Promise<ConfigurationResource[]>,
  ): Promise<ConfigurationResource[]> {
    const found: ConfigurationResource[] = [];
    if (context.scope === "project" && !context.projectId) return found;
    for (const provider of this.#providers)
      try {
        found.push(...(await run(provider)));
      } catch (error) {
        found.push({
          kind: provider.kinds[0],
          id: "(unavailable)",
          scope: "user",
          state: "invalid",
          diagnostics: [
            {
              level: "error",
              code: "provider-failed",
              message: `Could not be read: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        });
      }
    return found;
  }
}

/** Whether the user should be told: the resource is broken or waits for their decision. */
export function needsAttention(resource: ConfigurationResource): boolean {
  return (
    resource.state === "invalid" ||
    resource.state === "incompatible" ||
    resource.state === "needs_review" ||
    resource.diagnostics.some((diagnostic) => diagnostic.level === "error")
  );
}

/** One problem of one file, before the problems of a file are gathered into its resource. */
export type ResourceFinding = Pick<
  ConfigurationResource,
  "kind" | "id" | "scope"
> & {
  path?: string;
  diagnostic?: Diagnostic;
  approval?: ConfigurationResource["approval"];
  /** With `approval`: the user declined it, so nobody needs to act. */
  declined?: true;
  previousVersionActive?: true;
};

/** Words the state the agent sees when a resource waits for the user. */
export const approvalDiagnostic = (
  approval: NonNullable<ConfigurationResource["approval"]>,
): Diagnostic => ({
  level: "warning",
  code: "needs-review",
  message: `Valid, but not used until the user approves it in ${approval.where}. You cannot approve it; tell the user.`,
});

/** Words the state the agent sees when the user declined a resource: nothing to ask for. */
export const declinedDiagnostic = (
  approval: NonNullable<ConfigurationResource["approval"]>,
): Diagnostic => ({
  level: "warning",
  code: "declined",
  message: `The user declined this, so it is not used. Mention it only if it matters for the task; do not ask the user to reverse it. They can change it in ${approval.where}.`,
});

/** Gathers findings into one resource per file and derives its state. */
export function resourcesFromFindings(
  findings: readonly ResourceFinding[],
): ConfigurationResource[] {
  const byFile = new Map<string, ConfigurationResource>();
  const seen = new Set<string>();
  const declined = new Set<ConfigurationResource>();
  for (const finding of findings) {
    const key = [finding.kind, finding.scope, finding.id, finding.path].join(
      "\0",
    );
    let resource = byFile.get(key);
    if (!resource) {
      resource = {
        kind: finding.kind,
        id: finding.id,
        scope: finding.scope,
        ...(finding.path ? { path: finding.path } : {}),
        state: "active",
        diagnostics: [],
      };
      byFile.set(key, resource);
    }
    if (finding.previousVersionActive) resource.previousVersionActive = true;
    if (finding.approval && !resource.approval) {
      resource.approval = finding.approval;
      if (finding.declined) declined.add(resource);
      resource.diagnostics.push(
        finding.declined
          ? declinedDiagnostic(finding.approval)
          : approvalDiagnostic(finding.approval),
      );
    }
    const diagnostic = finding.diagnostic;
    if (!diagnostic) continue;
    const identity = [
      key,
      diagnostic.code,
      diagnostic.pointer,
      diagnostic.message,
    ].join("\0");
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
    else if (!broken && resource.approval)
      resource.state = declined.has(resource) ? "declined" : "needs_review";
  }
  return [...byFile.values()];
}
