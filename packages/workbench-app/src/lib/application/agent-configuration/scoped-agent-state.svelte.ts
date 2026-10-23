import {
  resolveAgentConfiguration,
  type AgentScope,
  type GetAgentConfigurationResult,
  type ResolutionResult,
  type ResolutionOptions,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import {
  observeConversationChannel,
  requestConversation,
} from "$lib/application/startup/conversation-connection";

import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/** One loaded editor, with the exact source version displayed to its user. */
export class ScopedAgentState {
  document = $state<GetAgentConfigurationResult>();
  role = $state<"lead" | "child">("lead");
  resolution = $state<ResolutionResult>();
  inherited = $state<ResolutionResult>();
  error = $state<string>();
  saving = $state(false);
  scope: AgentScope | undefined;
  private generation = 0;
  constructor(
    private readonly clampThinking?: ResolutionOptions["clampThinking"],
  ) {}

  get overrides(): LeadSettingsOverrides {
    return this.document?.status === "available" ? this.document.overrides : {};
  }
  async load(scope: AgentScope): Promise<void> {
    const generation = ++this.generation;
    if (JSON.stringify(this.scope) !== JSON.stringify(scope)) {
      this.document = undefined;
      this.resolution = undefined;
      this.inherited = undefined;
    }
    this.scope = scope;
    try {
      const document = await requestConversation("agentConfiguration.get", {
        scope,
      });
      if (generation !== this.generation) return;
      this.document = document;
      if (document.status !== "available")
        throw new Error(
          "Scoped configuration unavailable. Repair the document, then reload.",
        );
      if (scope.scope === "conversation") {
        const effective = await requestConversation(
          "agentConfiguration.getEffective",
          { conversationId: scope.conversationId },
        );
        if (generation !== this.generation) return;
        if (effective.status !== "available")
          throw new Error("Effective configuration unavailable.");
        this.role = effective.role;
        this.resolution = effective.resolution;
        this.inherited = undefined;
      } else {
        this.role = "lead";
        const user =
          scope.scope === "project"
            ? await requestConversation("agentConfiguration.get", {
                scope: { scope: "user" },
              })
            : undefined;
        if (generation !== this.generation) return;
        if (user && user.status !== "available")
          throw new Error(
            "User configuration unavailable. Project values cannot be resolved.",
          );
        const layers =
          scope.scope === "user"
            ? { user: document.overrides }
            : {
                user: user?.status === "available" ? user.overrides : undefined,
                project: document.overrides,
              };
        this.resolution = resolveAgentConfiguration({
          role: "lead",
          ...layers,
          clampThinking: this.clampThinking,
        });
        this.inherited = resolveAgentConfiguration({
          role: "lead",
          ...(scope.scope === "project" ? { user: layers.user } : {}),
          clampThinking: this.clampThinking,
        });
      }
      this.error = undefined;
    } catch (error) {
      if (generation === this.generation) {
        this.resolution = undefined;
        this.error = error instanceof Error ? error.message : String(error);
      }
    }
  }
  /** Explicit health reload republishes disk state before fetching the displayed version. */
  async reload(): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    try {
      await requestWorkbench("agentConfiguration.reload", {
        target: { document: "agent", scope },
      });
      if (this.scope === scope) await this.load(scope);
    } catch (error) {
      if (this.scope === scope)
        this.error = error instanceof Error ? error.message : String(error);
    }
  }
  async save(
    changes: LeadSettingsOverrides,
    resets: string[] = [],
  ): Promise<void> {
    const scope = this.scope;
    const document = this.document;
    if (!scope || document?.status !== "available" || this.saving) return;
    this.saving = true;
    try {
      const result = await requestConversation("agentConfiguration.save", {
        scope,
        expectedRevision: document.source.revision,
        expectedDigest: document.source.digest,
        changes,
        resets,
      });
      if (this.scope !== scope) return;
      await this.load(scope);
      if (result.status !== "saved")
        this.error = `Configuration ${result.status}. Reload and review your changes before trying again.`;
    } catch (error) {
      if (this.scope === scope)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }
  observe(): () => void {
    return observeConversationChannel({
      recover: () => (this.scope ? this.load(this.scope) : Promise.resolve()),
      disconnected() {},
      event() {},
      notice: (notice) => {
        if (notice.type === "agentConfiguration.changed" && this.scope)
          void this.load(this.scope);
      },
    });
  }
}
