<!--
  Project files that change how agents behave. Each trust domain is reviewed on
  its own, per machine: capabilities, permissions, and each profile file.
  Prompt-suggestion JavaScript is allowed or denied by you in Suggestions.
-->
<script lang="ts">
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldOff from "@lucide/svelte/icons/shield-off";
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsRow, SettingsSection } from "$lib/presentation/settings";
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import ProfileTrustReviewDialog from "../agent-profiles/ProfileTrustReviewDialog.svelte";
import ConfigurationRepairDialog from "../capabilities/ConfigurationRepairDialog.svelte";
import {
  agentProfilesState,
  refreshAgentProfiles,
} from "../../../state/agent-profiles.svelte";
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
const agentDocument = new ScopedAgentState();
$effect(() => {
  if (projectId) void agentDocument.load({ scope: "project", projectId });
});
$effect(() => agentDocument.observe());

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
let reviewOpen = $state(false);
let reviewProfile = $state<ProfileCatalogEntry>();
let repairOpen = $state(false);
let repairProfile = $state<ProfileCatalogEntry>();
let error = $state<string>();
async function trustProfile(): Promise<void> {
  const profile = reviewProfile;
  if (!projectId || !profile || busy) return;
  busy = profile.name;
  error = undefined;
  try {
    const result = await trustAgentProfile({
      target: {
        document: "profile",
        scope: { scope: "project", projectId },
        name: profile.name,
      },
      expectedDigest: profile.digest,
      trusted: !profile.trusted,
    });
    if (result.status !== "saved")
      throw new Error(
        `Trust ${result.status}; reload and review the current bytes.`,
      );
    await refreshAgentProfiles(projectId, "project");
    reviewOpen = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy = undefined;
  }
}
</script>

<SettingsSection id="trust" title="Configuration files" divided>
  {#if projectId}<SettingsRow
      label={agentDocument.document?.status === "available"
        ? agentDocument.document.source.path
        : ".nerve/agent.json"}
      mono
      description={agentDocument.error ??
        "Scoped models, tools, skills and delegation. Trust applies only to the exact reviewed bytes."}
      >{#snippet control()}<ProjectCapabilityTrustAction
          document={agentDocument.document}
          scope={{ scope: "project", projectId }}
          onReload={() => agentDocument.reload()}
        />{/snippet}</SettingsRow
    >{/if}
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
      description={profile.definition?.label ?? profile.name}
    >
      {#snippet badges()}
        <Badge variant={profile.trusted ? "success" : "warning"}
          >{profile.trusted ? "Trusted" : "Needs review"}</Badge
        >
      {/snippet}
      {#snippet control()}
        {#if profile.definition}
          <Button
            size="sm"
            variant="outline"
            disabled={busy === profile.name}
            onclick={() => {
              reviewProfile = profile;
              error = undefined;
              reviewOpen = true;
            }}
            >{profile.trusted
              ? "Review / revoke trust"
              : "Review and trust"}</Button
          >
        {/if}
        <Button
          size="sm"
          variant="ghost"
          onclick={() => {
            repairProfile = profile;
            repairOpen = true;
          }}>Preview repair</Button
        >
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

<ProfileTrustReviewDialog
  bind:open={reviewOpen}
  profile={reviewProfile}
  lines={[]}
  busy={!!busy}
  {error}
  onTrust={trustProfile}
/>
{#if projectId && repairProfile}<ConfigurationRepairDialog
    bind:open={repairOpen}
    target={{
      document: "profile",
      scope: { scope: "project", projectId },
      name: repairProfile.name,
    }}
    replacement={repairProfile.definition ?? {
      schemaVersion: 1,
      name: repairProfile.name,
      whenToUse: "Recovered profile",
      usableBy: "lead",
      instructions: "",
    }}
    onRepaired={() => refreshAgentProfiles(projectId, "project")}
  />{/if}
