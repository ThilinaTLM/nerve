<script lang="ts">
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ModelPicker from "$lib/features/settings/views/shared/model-picker/ModelPicker.svelte";
import ConversationProfilesView from "$lib/features/conversations/context/ConversationProfilesView.svelte";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import type { ModelSelection } from "@nervekit/contracts/models";
import {
  ConversationProfileController,
  type ConversationProfileState,
  type ConversationProfileScope,
} from "./conversation-profile-controller";

let {
  scope,
  query = "",
  unavailableReason,
}: {
  scope?: ConversationProfileScope;
  query?: string;
  unavailableReason?: string;
} = $props();
const projectId = $derived(scope?.projectId);
const conversationId = $derived(scope?.conversationId);
let state = $state<ConversationProfileState>({ loading: false, saving: false });
const controller = new ConversationProfileController({
  read: (scope) =>
    requestWorkbench("subagentProfiles.configuration", {
      scope: "conversation",
      ...scope,
    }),
  update: (scope, name, patch, expectedDigest) =>
    requestWorkbench("subagentProfiles.update", {
      scope: "conversation",
      ...scope,
      name,
      patch,
      expectedDigest,
    }),
  changed: (next) => {
    state = next;
  },
});
const models = $derived(
  authenticatedRealModelOptions(
    settingsState.models,
    settingsState.authProviders,
  ),
);
$effect(() => {
  controller.follow(
    projectId && conversationId ? { projectId, conversationId } : undefined,
  );
  return () => controller.follow(undefined);
});
$effect(() => {
  if (!conversationId) return;
  const dispose = onEvent("subagentProfiles.changed", (event) => {
    if (
      (!event.data.projectId || event.data.projectId === projectId) &&
      (!event.data.conversationId ||
        event.data.conversationId === conversationId)
    )
      void controller.refresh();
  });
  const refresh = () => {
    void controller.refresh();
  };
  const availability = [
    "providers.catalog_changed",
    "auth.providers_changed",
    "auth.integration_health_changed",
    "auth.credential_deleted",
    "secrets.provider_key_set",
    "secrets.provider_key_deleted",
    "settings.updated",
    "applicationConfiguration.updated",
  ].map((type) => onEvent(type, refresh));
  const capabilities = onEvent("project.capabilities.changed", (event) => {
    if (event.data.projectId === projectId) refresh();
  });
  const conversationChannel = observeConversationChannel({
    recover: async () => {
      await controller.refresh();
    },
    disconnected() {},
    event() {},
    notice: (notice) => {
      if (
        notice.type === "capabilities.changed" &&
        notice.data.projectId === projectId &&
        (!notice.data.conversationId ||
          notice.data.conversationId === conversationId)
      )
        refresh();
    },
  });
  const reconnect = onWorkbenchReconnect(refresh);
  return () => {
    dispose();
    capabilities();
    conversationChannel();
    for (const stop of availability) stop();
    reconnect();
  };
});
function selection(value: string | undefined): ModelSelection | undefined {
  if (!value || value === "lead") return;
  const slash = value.indexOf("/");
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}
</script>

<ConversationProfilesView
  {query}
  unavailableReason={!scope
    ? (unavailableReason ??
      "Save a lead conversation before configuring sub-agent profiles.")
    : undefined}
  configuration={state.configuration}
  loading={state.loading}
  saving={state.saving}
  error={state.error}
  onPatch={(name, patch) => {
    void controller.mutate(name, patch);
  }}
  onRefresh={() => {
    void controller.refresh();
  }}
>
  {#snippet modelEditor(profile, disabled)}
    <ModelPicker
      label={`Model for ${profile.name}`}
      {models}
      value={selection(profile.effective?.model ?? profile.local?.model)}
      thinkingLevel={undefined}
      showReasoning={false}
      {disabled}
      inherit={(profile.effective?.model ?? profile.local?.model) === "lead"}
      inheritOption={{
        label: "Use parent's model",
        description:
          "Copy this conversation's model when creating a child. This is an explicit choice, not a profile reset.",
      }}
      onInherit={() => {
        void controller.mutate(profile.name, { model: "lead" });
      }}
      onChange={(next) => {
        // The picker derives a reasoning default; profile thinking is independently pinned.
        // Preserve it even if this model is incompatible, and show resolver diagnostics.
        if (next.model)
          void controller.mutate(profile.name, {
            model: `${next.model.provider}/${next.model.modelId}`,
          });
      }}
    />
  {/snippet}
</ConversationProfilesView>
