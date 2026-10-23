import type {
  EffectiveAgentView,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import {
  observeConversationChannel,
  requestConversation,
} from "$lib/application/startup/conversation-connection";
import {
  getHarnessSettings,
  updateHarnessCompaction,
} from "../adapters/core-harness-settings.adapter";

/**
 * Harness settings (today: compaction) of the conversation being viewed.
 * Follows the viewed conversation and refreshes on scoped configuration changes.
 */
export class ConversationHarnessState {
  result = $state<EffectiveAgentView>();
  private configuration: GetAgentConfigurationResult | undefined;
  error = $state<string>();
  saving = $state(false);
  get compaction(): AutoCompactionSettings | undefined {
    const value =
      this.result?.status === "available"
        ? this.result.resolution.settings.compaction
        : undefined;
    if (
      value?.auto === undefined ||
      value.profile === undefined ||
      value.customTriggerPercent === undefined
    )
      return undefined;
    return {
      auto: value.auto,
      profile: value.profile,
      customTriggerPercent: value.customTriggerPercent,
    };
  }
  get overridden(): boolean {
    return (
      this.result?.status === "available" &&
      Object.entries(this.result.resolution.provenance).some(
        ([pointer, value]) =>
          pointer.startsWith("/compaction/") && value.source === "conversation",
      )
    );
  }
  private scope: { projectId: string; conversationId: string } | undefined;

  /** Starts following a conversation; pass undefined to stop. */
  follow(projectId: string | undefined, conversationId: string | undefined) {
    if (
      this.scope?.projectId === projectId &&
      this.scope?.conversationId === conversationId
    )
      return;
    this.result = undefined;
    this.configuration = undefined;
    this.error = undefined;
    this.scope =
      projectId && conversationId ? { projectId, conversationId } : undefined;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    try {
      const [result, configuration] = await Promise.all([
        getHarnessSettings(scope.projectId, scope.conversationId),
        requestConversation("agentConfiguration.get", {
          scope: {
            scope: "conversation",
            conversationId: scope.conversationId,
          },
        }),
      ]);
      if (this.scope === scope) {
        this.result = result;
        this.configuration = configuration;
        this.error = undefined;
      }
    } catch (error) {
      if (this.scope === scope)
        this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /** `null` resets to the inherited value. Throws so callers can report. */
  async saveCompaction(compaction: AutoCompactionSettings | null) {
    const scope = this.scope;
    if (!scope) return;
    const configuration = this.configuration;
    if (configuration?.status !== "available")
      throw new Error("Configuration unavailable. Refresh and try again.");
    this.saving = true;
    try {
      const result = await updateHarnessCompaction(
        scope.projectId,
        scope.conversationId,
        compaction,
        configuration.source,
      );
      if (this.scope === scope) {
        this.result = result;
        await this.refresh();
      }
    } catch (error) {
      await this.refresh();
      throw error;
    } finally {
      this.saving = false;
    }
  }

  /** Observes scoped configuration changes affecting the followed conversation. */
  observe(): () => void {
    return observeConversationChannel({
      recover: () => this.refresh(),
      disconnected() {},
      event() {},
      notice: (notice) => {
        if (notice.type !== "agentConfiguration.changed") return;
        const scope = this.scope;
        if (
          scope &&
          (notice.data.scope.scope === "user" ||
            (notice.data.scope.scope === "project" &&
              notice.data.scope.projectId === scope.projectId) ||
            (notice.data.scope.scope === "conversation" &&
              notice.data.scope.conversationId === scope.conversationId))
        )
          void this.refresh();
      },
    });
  }
}
