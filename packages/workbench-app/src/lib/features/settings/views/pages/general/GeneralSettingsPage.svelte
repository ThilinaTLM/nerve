<script lang="ts">
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  SettingsRow,
  SettingsSection,
  SettingsInlineMessage,
} from "$lib/presentation/settings";
import { CreationPreferencesState } from "../../../state/creation-preferences.svelte";
import {
  ensureProfilesFor,
  leadProfileOptions,
} from "../../shared/profile-options.svelte";

let { scope, projectId }: { scope: "user" | "project"; projectId?: string } =
  $props();
const preferences = new CreationPreferencesState();
$effect(() => {
  ensureProfilesFor(scope, projectId);
  if (scope === "project" && !projectId) return;
  void preferences.load(
    scope === "project" ? { scope, projectId: projectId! } : { scope },
  );
});
$effect(() => preferences.observe());
const available = $derived(
  preferences.result?.status === "available" ? preferences.result : undefined,
);
const profiles = $derived(
  leadProfileOptions().map((profile) => ({
    value: profile.name,
    label: profile.label,
  })),
);
</script>

<SettingsSection title="New conversations">
  <SettingsRow
    label="Start profile"
    description="Used when no profile is explicitly selected."
  >
    {#snippet control()}
      <SelectField
        value={available?.effective.defaultAgentProfile ?? ""}
        items={profiles}
        disabled={!available || preferences.saving}
        onValueChange={(defaultAgentProfile) =>
          preferences.save({ defaultAgentProfile })}
      />
    {/snippet}
  </SettingsRow>
  {#if available?.overrides.defaultAgentProfile !== undefined}
    <Button
      size="sm"
      variant="ghost"
      disabled={preferences.saving}
      onclick={() => preferences.save({}, ["/overrides/defaultAgentProfile"])}
      >Reset start profile</Button
    >
  {/if}
</SettingsSection>
{#if preferences.error}<SettingsInlineMessage
    tone="destructive"
    text={preferences.error}
  />{/if}
<p class="text-xs text-muted-foreground">
  Scoped agent preference editors will return in Phase 4. Conversation model,
  permission and compaction choices remain available in the conversation.
</p>
