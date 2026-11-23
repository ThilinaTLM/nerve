<!--
  Project files that change how agents behave. Each trust domain is reviewed on
  its own, per machine: capabilities, permissions, each profile file and each
  project extension.
-->
<script lang="ts">
import {
  PageEmptyState,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import ProjectCapabilityTrustAction from "../capabilities/ProjectCapabilityTrustAction.svelte";
import Blocks from "@lucide/svelte/icons/blocks";
import Bot from "@lucide/svelte/icons/bot";
import FileText from "@lucide/svelte/icons/file-text";
import type { BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsSection, TipBadge } from "$lib/presentation/settings";
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import type { ExtensionCatalogEntry } from "@nervekit/contracts/extensions";
import { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import ExtensionConsentDialog from "../extensions/ExtensionConsentDialog.svelte";
import { installedProblem } from "../extensions/extensions-view";
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
  /** What the file is, e.g. "Permission rules". */
  title: string;
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
  /** The project's directory; paths show relative to it, the full path in a tooltip. */
  projectDirectory?: string;
  /** Capabilities and permissions files, from their controllers. */
  entries: TrustEntry[];
};
let { projectId, projectDirectory, entries }: Props = $props();

const root = $derived(
  projectDirectory?.replaceAll("\\", "/").replace(/\/$/, ""),
);
/** Project-relative path of a file or directory the project owns. */
function relative(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return root && normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}
/** The full path, for the icon's tooltip. */
const absolute = (path: string): string =>
  root && !path.startsWith("/") ? `${root}/${path}` : path;
const agentDocument = new ScopedAgentState();
$effect(() => {
  if (projectId) void agentDocument.load({ scope: "project", projectId });
});
$effect(() => agentDocument.observe());

$effect(() => {
  ensureProfilesFor("project", projectId);
});
const extensions = new ScopedExtensionsState();
$effect(() => {
  if (projectId) void extensions.load({ scope: "project", projectId });
});
/** Installed project extensions whose consent is a decision to show: allowed or waiting. */
const projectExtensions = $derived(
  (extensions.view?.catalog ?? []).filter(
    (entry) =>
      entry.source === "project" &&
      (entry.state === "enabled" || entry.state === "pending_consent"),
  ),
);
let extensionReview = $state<ExtensionCatalogEntry>();
let extensionReviewOpen = $state(false);
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
const tips: Record<TrustEntry["status"], string> = {
  trusted: "Reviewed by you. It applies only while its content is unchanged.",
  untrusted: "Ignored until you review it. Any change asks again.",
  invalid: "The file can't be read, so it is ignored.",
  missing: "The project has no such file.",
};

/** Status of the project's capabilities file (`.nerve/agent.json`). */
const agentStatus = $derived.by((): TrustEntry["status"] => {
  const document = agentDocument.document;
  if (document?.status !== "available") return document ? "invalid" : "missing";
  if (document.source.digest === "missing") return "missing";
  return document.trusted === false ? "untrusted" : "trusted";
});
const agentPath = $derived(
  agentDocument.document?.status === "available"
    ? relative(agentDocument.document.source.path)
    : ".nerve/agent.json",
);

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

{#snippet status(value: TrustEntry["status"])}
  <TipBadge text={labels[value]} tip={tips[value]} variant={tones[value]} />
{/snippet}

<SettingsSection id="trust" title="Configuration files" surface={false}>
  <PageList ariaLabel="Configuration files">
    {#if projectId}
      <PageItem
        title="Agent capabilities"
        icon={FileText}
        iconLabel={`Scoped models, tools, skills and delegation · ${absolute(agentPath)}`}
        summary={agentPath}
        mono
        problem={agentDocument.error}
      >
        {#snippet badges()}{@render status(agentStatus)}{/snippet}
        {#snippet actions()}
          {#if agentStatus !== "missing"}
            <ProjectCapabilityTrustAction
              document={agentDocument.document}
              scope={{ scope: "project", projectId }}
              onReload={() => agentDocument.reload()}
              variant="outline"
              label={agentStatus === "untrusted"
                ? "Review and trust"
                : agentStatus === "trusted"
                  ? "Revoke trust"
                  : "Review"}
            />
          {/if}
        {/snippet}
      </PageItem>
    {/if}
    {#each entries as entry (entry.id)}
      <PageItem
        title={entry.title}
        icon={FileText}
        iconLabel={`${entry.description} · ${absolute(entry.path)}`}
        summary={relative(entry.path)}
        mono
        problem={entry.status === "invalid" ? entry.detail : undefined}
      >
        {#snippet badges()}{@render status(entry.status)}{/snippet}
        {#snippet actions()}
          {#if entry.status === "untrusted" && entry.onTrust}
            <Button size="sm" variant="outline" onclick={entry.onTrust}
              >Review and trust</Button
            >
          {:else if entry.status === "trusted" && entry.onRevoke}
            <Button size="sm" variant="outline" onclick={entry.onRevoke}
              >Revoke trust</Button
            >
          {/if}
        {/snippet}
      </PageItem>
    {/each}
  </PageList>
</SettingsSection>

<SettingsSection id="profile-files" title="Agent profile files" surface={false}>
  {#if profileFiles.length === 0}
    <PageEmptyState variant="card" icon={Bot} title="None." />
  {:else}
    <PageList ariaLabel="Agent profile files">
      {#each profileFiles as profile (profile.name)}
        {@const path = relative(
          profile.path ?? `.nerve/agent-profiles/${profile.name}.json`,
        )}
        {@const value = profile.trusted ? "trusted" : "untrusted"}
        <PageItem
          title={profile.definition?.label ?? profile.name}
          icon={Bot}
          iconLabel={absolute(path)}
          summary={path}
          mono
        >
          {#snippet badges()}{@render status(value)}{/snippet}
          {#snippet actions()}
            <Button
              size="sm"
              variant="outline"
              disabled={busy === profile.name}
              onclick={() => {
                if (profile.definition) {
                  reviewProfile = profile;
                  error = undefined;
                  reviewOpen = true;
                } else {
                  repairProfile = profile;
                  repairOpen = true;
                }
              }}
              >{profile.definition
                ? profile.trusted
                  ? "Revoke trust"
                  : "Review and trust"
                : "Preview repair"}</Button
            >
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  {/if}
</SettingsSection>

<SettingsSection
  id="project-extensions"
  title="Project extensions"
  surface={false}
>
  {#if projectExtensions.length === 0}
    <PageEmptyState variant="card" icon={Blocks} title="None." />
  {:else}
    <PageList ariaLabel="Project extensions">
      {#each projectExtensions as entry (entry.path ?? entry.id)}
        {@const path = relative(entry.path ?? `.nerve/extensions/${entry.id}`)}
        {@const value = entry.state === "enabled" ? "trusted" : "untrusted"}
        <PageItem
          title={entry.name ?? entry.id}
          icon={Blocks}
          iconLabel={absolute(path)}
          summary={path}
          mono
          problem={installedProblem(entry)}
        >
          {#snippet badges()}{@render status(value)}{/snippet}
          {#snippet actions()}
            {#if entry.state === "enabled"}
              <Button
                size="sm"
                variant="outline"
                disabled={extensions.saving}
                onclick={() => void extensions.revokeConsent(entry)}
                >Revoke trust</Button
              >
            {:else if entry.consent}
              <Button
                size="sm"
                variant="outline"
                onclick={() => {
                  extensionReview = entry;
                  extensionReviewOpen = true;
                }}>Review and trust</Button
              >
            {/if}
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  {/if}
</SettingsSection>

<ExtensionConsentDialog
  bind:open={extensionReviewOpen}
  entry={extensionReview}
  busy={extensions.saving}
  onAllow={(entry) => void extensions.grantConsent(entry)}
/>
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
