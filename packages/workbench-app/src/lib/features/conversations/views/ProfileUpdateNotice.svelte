<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type {
  AppliedProfile,
  ProfileTransitionPreview,
} from "@nervekit/contracts/agent-configuration";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { EntityRow } from "$lib/presentation/settings";
import {
  requestConversation,
  observeConversationChannel,
} from "$lib/application/startup/conversation-connection";
import { notify } from "$lib/application/notifications/notify.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  profileChangeValue,
  profileChangeSummary,
} from "./profile-transition-diff";
let {
  conversationId,
  applied,
  onApplied,
}: {
  conversationId: string;
  applied: AppliedProfile;
  onApplied: () => Promise<void>;
} = $props();
let preview = $state<ProfileTransitionPreview>();
let open = $state(false);
let saving = $state(false);
let stale = $state(false);
let error = $state<string>();
let noticed = $state("");
const conflict = $derived(
  preview?.resolution.diagnostics.some(
    (d) => d.code === "unsupported-reasoning" || d.code === "model-required",
  ) ?? false,
);

async function refresh(show = false) {
  const id = conversationId;
  const captured = applied;
  const result = await requestConversation("conversation.previewAgentProfile", {
    conversationId: id,
    profile: captured.name,
  });
  if (id !== conversationId || captured !== applied) return;
  if (result.status !== "ready") {
    if (show)
      error = "Profile unavailable or untrusted. Repair it, then review again.";
    return;
  }
  if (open && !show && preview) {
    if (
      preview.targetProfile.digest !== result.preview.targetProfile.digest ||
      preview.expectedRevision !== result.preview.expectedRevision ||
      preview.expectedDigest !== result.preview.expectedDigest
    ) {
      stale = true;
      error =
        "Configuration changed since this preview. Review again before confirming.";
    }
    return;
  }
  stale = false;
  if (show) error = undefined;
  preview = result.preview;
  if (
    result.preview.targetProfile.digest !== captured.sourceDigest &&
    noticed !== `${id}:${result.preview.targetProfile.digest}`
  ) {
    noticed = `${id}:${result.preview.targetProfile.digest}`;
    notify.warning("Updated profile available", {
      description: `${captured.name} has changed. Your current snapshot is unchanged.`,
      action: {
        label: "Review",
        onClick: () => {
          open = true;
        },
      },
    });
  }
  if (show) open = true;
}
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void conversationId;
  void applied;
  void refresh().catch(() => undefined);
});
$effect(() =>
  observeConversationChannel({
    recover: () => refresh().catch(() => undefined),
    disconnected() {},
    event() {},
    notice: (notice) => {
      if (notice.type === "agentConfiguration.changed")
        void refresh().catch(() => undefined);
    },
  }),
);
async function apply() {
  if (!preview || saving || stale) return;
  saving = true;
  error = undefined;
  try {
    const result = await requestConversation("conversation.setAgentProfile", {
      conversationId,
      action: "reapply",
      targetProfile: preview.targetProfile,
      expectedRevision: preview.expectedRevision,
      expectedDigest: preview.expectedDigest,
    });
    if (result.status === "applied") {
      await onApplied();
      open = false;
      notify.success("Updated profile applied", {
        description: "Conversation choices were preserved.",
      });
    } else {
      preview =
        result.status === "refresh_required" ? result.preview : undefined;
      error =
        "Profile or configuration changed. Review the refreshed preview and confirm again. Nothing was applied.";
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
</script>
{#if preview && preview.targetProfile.digest !== applied.sourceDigest}
  <Button
    size="sm"
    variant="ghost"
    onclick={() => {
      error = undefined;
      void refresh(true).catch((cause) => {
        error = String(cause);
      });
    }}>Apply updated profile</Button
  >
{/if}
<Dialog
  bind:open
  title={`Apply updated ${applied.name} profile`}
  description="Only changed fields are shown. Your conversation choices are preserved."
>
  {#if error}<Callout layout="block" tone="destructive" text={error} />{/if}
  {#if conflict}<Callout
      layout="block"
      tone="destructive"
      text="Profile requirement conflict: a model is missing or the required reasoning is unsupported by the effective model. Repair the definition or choose compatible underlying settings, then review again."
    />{/if}
  {#if preview}
    {#each preview.changedFields as row (row.pointer)}
      <EntityRow label={row.pointer} value={profileChangeSummary(row)} />
    {/each}
    {#if !preview.changedFields.length}<p class="text-ui text-muted-foreground">
        No effective setting or instruction changed. The definition metadata or
        shadowed recommendations changed; your explicit choices remain intact.
      </p>{/if}
    {#if preview.unchangedRequirements.length}
      <details class="text-ui">
        <summary class="cursor-pointer text-muted-foreground"
          >Unchanged requirements <Badge variant="outline"
            >{preview.unchangedRequirements.length}</Badge
          ></summary
        >
        {#each preview.unchangedRequirements as row (row.pointer)}<EntityRow
            label={row.pointer}
            value={profileChangeValue(row.value)}
          />{/each}
      </details>
    {/if}
    <details class="text-ui">
      <summary class="cursor-pointer text-muted-foreground"
        >Target definition details</summary
      ><EntityRow
        label="Label"
        value={preview.targetDefinition.label ?? preview.targetDefinition.name}
      /><EntityRow
        label="When to use"
        value={preview.targetDefinition.whenToUse}
      /><EntityRow
        label="Usable by"
        value={preview.targetDefinition.usableBy}
      /><EntityRow
        label="Instructions"
        value={preview.targetDefinition.instructions || "(empty)"}
      />
    </details>
  {/if}
  <div class="flex justify-end gap-2">
    {#if error || conflict}<Button
        variant="outline"
        disabled={saving}
        onclick={() =>
          refresh(true).catch((cause) => {
            error = String(cause);
          })}>Review again</Button
      >{/if}<Button
      variant="outline"
      disabled={saving}
      onclick={() => {
        open = false;
      }}>Cancel</Button
    ><Button disabled={saving || !preview || stale || conflict} onclick={apply}
      >{saving ? "Applying…" : "Apply updated profile"}</Button
    >
  </div>
</Dialog>
