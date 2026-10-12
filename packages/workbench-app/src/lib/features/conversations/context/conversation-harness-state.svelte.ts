import type { ConversationHarnessSettingsResult } from "@nervekit/contracts/core";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";
import {
  getHarnessSettings,
  updateHarnessCompaction,
} from "../adapters/core-harness-settings.adapter";

/**
 * Harness settings (today: compaction) of the conversation being viewed.
 * Follows the viewed conversation and refreshes when capabilities change.
 */
export class ConversationHarnessState {
  result = $state<ConversationHarnessSettingsResult>();
  error = $state<string>();
  saving = $state(false);
  private scope: { projectId: string; conversationId: string } | undefined;

  /** Starts following a conversation; pass undefined to stop. */
  follow(projectId: string | undefined, conversationId: string | undefined) {
    if (
      this.scope?.projectId === projectId &&
      this.scope?.conversationId === conversationId
    )
      return;
    this.result = undefined;
    this.error = undefined;
    this.scope =
      projectId && conversationId ? { projectId, conversationId } : undefined;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    try {
      const result = await getHarnessSettings(
        scope.projectId,
        scope.conversationId,
      );
      if (this.scope === scope) {
        this.result = result;
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
    this.saving = true;
    try {
      const result = await updateHarnessCompaction(
        scope.projectId,
        scope.conversationId,
        compaction,
      );
      if (this.scope === scope) this.result = result;
    } finally {
      this.saving = false;
    }
  }

  /** Observes `capabilities.changed` for the followed conversation. */
  observe(): () => void {
    return observeConversationChannel({
      recover: () => this.refresh(),
      disconnected() {},
      event() {},
      notice: (notice) => {
        if (notice.type !== "capabilities.changed") return;
        const scope = this.scope;
        if (
          scope &&
          notice.data.projectId === scope.projectId &&
          (notice.data.conversationId === undefined ||
            notice.data.conversationId === scope.conversationId)
        )
          void this.refresh();
      },
    });
  }
}
