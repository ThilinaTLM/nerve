import type {
  GetCreationPreferencesResult,
  PreferenceScope,
  CreationPreferencesMutation,
} from "@nervekit/contracts/agent-configuration";
import {
  requestConversation,
  observeConversationChannel,
} from "$lib/application/startup/conversation-connection";

import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/** Each settings view holds the version it displayed, never a speculative CAS token. */
export class CreationPreferencesState {
  result = $state<GetCreationPreferencesResult>();
  error = $state<string>();
  saving = $state(false);
  private scope: PreferenceScope | undefined;
  private generation = 0;

  async load(scope: PreferenceScope): Promise<void> {
    if (
      this.scope?.scope !== scope.scope ||
      (scope.scope === "project" &&
        this.scope?.scope === "project" &&
        this.scope.projectId !== scope.projectId)
    )
      this.result = undefined;
    this.scope = scope;
    const generation = ++this.generation;
    try {
      const result = await requestConversation("conversationDefaults.get", {
        scope,
      });
      if (generation !== this.generation) return;
      this.result = result;
      this.error =
        result.status === "available"
          ? undefined
          : "Creation preferences unavailable.";
    } catch (error) {
      if (generation === this.generation) {
        this.result = undefined;
        this.error = String(error);
      }
    }
  }

  async reload(): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    try {
      await requestWorkbench("agentConfiguration.reload", {
        target: { document: "conversation-defaults", scope },
      });
      if (this.scope === scope) await this.load(scope);
    } catch (error) {
      if (this.scope === scope)
        this.error = error instanceof Error ? error.message : String(error);
    }
  }
  async save(
    changes: CreationPreferencesMutation["changes"],
    resets: CreationPreferencesMutation["resets"] = [],
  ): Promise<void> {
    const current = this.result;
    const scope = this.scope;
    if (this.saving || !scope || current?.status !== "available") return;
    this.saving = true;
    try {
      const result = await requestConversation("conversationDefaults.save", {
        scope,
        expectedRevision: current.source.revision,
        expectedDigest: current.source.digest,
        changes,
        resets,
      });
      if (this.scope !== scope) return;
      await this.load(scope);
      if (this.scope === scope && result.status !== "saved")
        this.error = `Creation preferences ${result.status}. Refresh and try again.`;
    } catch (error) {
      if (this.scope === scope) this.error = String(error);
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
        if (notice.type === "conversationDefaults.changed" && this.scope)
          void this.load(this.scope);
      },
    });
  }
}
