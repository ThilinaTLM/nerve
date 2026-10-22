<!--
  Project files that change how agents behave. Each trust domain is reviewed on
  its own, per machine: capabilities, permissions, and each profile file.
  Prompt-suggestion JavaScript is allowed or denied by you in Suggestions.
-->
<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldOff from "@lucide/svelte/icons/shield-off";
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsRow, SettingsSection } from "$lib/presentation/settings";
import { agentProfilesState } from "../../../state/agent-profiles.svelte";
import { trustAgentProfile } from "../../../api/agent-profiles.api";
import { ensureProfilesFor } from "../../shared/profile-options.svelte";

export type TrustEntry = {
  id: string;
  /** Project-relative file path. */
  path: string;
  description: string;
  status: "trusted" | "untrusted" | "invalid" | "missing";
  /** Why it is untrusted or invalid. */
  detail?: string;
  onTrust?: () => void;
  onRevoke?: () => void;
};

type Props = {
  projectId?: string;
  /** Capabilities and permissions files, from their controllers. */
  entries: TrustEntry[];
};
let { projectId, entries }: Props = $props();

$effect(() => {
  ensureProfilesFor("project", projectId);
});
const profileFiles = $derived(
  agentProfilesState.scope === "project" &&
    agentProfilesState.projectId === projectId
    ? (agentProfilesState.configuration?.profiles ?? []).filter(
        (profile) => profile.local,
      )
    : [],
);

const tones: Record<TrustEntry["status"], BadgeVariant> = {
  trusted: "success",
  untrusted: "warning",
  invalid: "destructive",
  missing: "neutral",
};
const labels: Record<TrustEntry["status"], string> = {
  trusted: "Trusted",
  untrusted: "Needs review",
  invalid: "Invalid",
  missing: "No file",
};

let busy = $state<string>();
async function trustProfile(name: string, digest: string): Promise<void> {
  if (!projectId) return;
  busy = name;
  try {
    agentProfilesState.configuration = await trustAgentProfile({
      projectId,
      name,
      digest,
    });
  } finally {
    busy = undefined;
  }
}
</script>

<SettingsSection id="trust" title="Configuration files" divided>
  {#each entries as entry (entry.id)}
    <SettingsRow
      label={entry.path}
      mono
      description={entry.detail ?? entry.description}
    >
      {#snippet badges()}<Badge variant={tones[entry.status]}
          >{labels[entry.status]}</Badge
        >{/snippet}
      {#snippet control()}
        {#if entry.status === "untrusted" && entry.onTrust}
          <Button size="sm" variant="outline" onclick={entry.onTrust}
            ><ShieldCheck class="size-3.5" aria-hidden="true" />Trust file</Button
          >
        {:else if entry.status === "trusted" && entry.onRevoke}
          <Button
            size="sm"
            variant="ghost"
            class="text-muted-foreground"
            onclick={entry.onRevoke}
            ><ShieldOff class="size-3.5" aria-hidden="true" />Revoke trust</Button
          >
        {/if}
      {/snippet}
    </SettingsRow>
  {/each}
</SettingsSection>

<SettingsSection
  id="profile-files"
  title="Agent profile files"
  description="One file per profile. Trust applies to the exact version reviewed."
  divided
>
  {#each profileFiles as profile (profile.name)}
    <SettingsRow
      label={profile.path ?? `.nerve/agent-profiles/${profile.name}.json`}
      mono
      description={profile.effective?.label ?? profile.name}
    >
      {#snippet badges()}
        <Badge variant={profile.trust === "trusted" ? "success" : "warning"}
          >{profile.trust === "trusted" ? "Trusted" : "Needs review"}</Badge
        >
      {/snippet}
      {#snippet control()}
        {#if profile.trust !== "trusted" && profile.digest}
          <Button
            size="sm"
            variant="outline"
            disabled={busy === profile.name}
            onclick={() => void trustProfile(profile.name, profile.digest!)}
            >Trust file</Button
          >
        {/if}
      {/snippet}
    </SettingsRow>
  {:else}
    <p class="px-3 py-3 text-sm text-muted-foreground">
      No project profile files.
    </p>
  {/each}
</SettingsSection>

<SettingsSection
  id="suggestion-scripts"
  title="Prompt suggestions"
  description="JavaScript conditions in suggestions are allowed or denied per suggestion in Suggestions. That choice is yours, not the project's."
  divided
>
  <SettingsRow
    label="Suggestion JavaScript"
    description="Not covered by the files above."
  />
</SettingsSection>
