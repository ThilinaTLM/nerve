<script lang="ts">
import { PageEmptyState } from "@nervekit/ui-kit/components/composites/page";
import { untrack } from "svelte";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { AuthProviderMetadata, AvailableSkill, ModelInfo } from "$lib/api";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { onConfigurationDecision } from "$lib/application/configuration-review/configuration-review-queue.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { modelDisplayName, modelKey } from "$lib/presentation/utils/model";
import ProfileDetail from "./ProfileDetail.svelte";
import ProfilesList from "./ProfilesList.svelte";
import type { ProfileRow } from "./profile-groups";
import type { ProfileKind } from "./profile-kind";
import type { ChangeTextDeps } from "./profile-summary";
import { profilesPageState } from "./profiles-page-state.svelte";
import { ProfilesStore } from "./profiles-store.svelte";

let {
  kind,
  projectId,
  projectName,
  models = [],
  authProviders = [],
  skills = [],
  itemId = "",
  onOpenItem,
  onCloseItem,
  onOpenFile,
}: {
  kind: ProfileKind;
  /** The open project; without one the page has only the User layer. */
  projectId?: string;
  projectName?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  skills?: AvailableSkill[];
  /** The open profile's `origin:name`; "" shows the list. */
  itemId?: string;
  onOpenItem?: (id: string) => void;
  onCloseItem?: () => void;
  onOpenFile?: (path: string) => void;
} = $props();

const store = new ProfilesStore();
let actionError = $state<string>();

$effect(() => {
  void store.load(projectId);
  if (projectId) void permissionRuleSetCatalog.ensure(projectId);
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void store.userEditor.load({ scope: "user" });
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !projectId) return;
  void store.projectEditor.load({ scope: "project", projectId });
});
$effect(() => store.userEditor.observe());
$effect(() => store.projectEditor.observe());
$effect(() => {
  const refresh = () => void store.reload();
  const stopEvents = onAnyEvent((event) => {
    if (
      event.type === "agentProfiles.changed" ||
      /^(providers|auth|secrets|skills)\./.test(event.type)
    )
      refresh();
  });
  const stopReconnect = onWorkbenchReconnect(refresh);
  const stopDecisions = onConfigurationDecision((review) => {
    if (review.target.kind === "agent-profile") refresh();
  });
  return () => {
    stopEvents();
    stopReconnect();
    stopDecisions();
  };
});

// The header's New profile button asks; the page creates and opens the profile.
$effect(() => {
  profilesPageState.projectName = projectName;
  return () => {
    profilesPageState.projectName = undefined;
  };
});
$effect(() => {
  const request = profilesPageState.newProfile;
  if (!request || request.kind !== kind) return;
  profilesPageState.newProfile = undefined;
  untrack(() => void create(request.layer));
});

async function create(layer: "user" | "project") {
  actionError = undefined;
  try {
    onOpenItem?.(await store.createProfile(layer, kind));
  } catch (error) {
    actionError = error instanceof Error ? error.message : String(error);
  }
}
async function duplicate(row: ProfileRow) {
  actionError = undefined;
  try {
    onOpenItem?.(await store.duplicate(row));
  } catch (error) {
    actionError = error instanceof Error ? error.message : String(error);
  }
}

const rules = $derived(permissionRuleSetCatalog.summaries(projectId));
const textDeps = $derived<ChangeTextDeps>({
  modelName: (selection) => {
    const model = models.find((m) => modelKey(m) === modelKey(selection));
    return model ? modelDisplayName(model) : selection.modelId;
  },
  permissionName: (id) => rules.find((r) => r.id === id)?.name ?? id,
  profileLabel: (name) => {
    const groups = store.rows();
    return (
      [...groups.project, ...groups.user, ...groups.builtin].find(
        (row) => row.name === name,
      )?.entry.definition?.label ?? name
    );
  },
});
const open = $derived(itemId ? store.find(itemId) : undefined);
const diagnostics = $derived([
  ...(store.user?.diagnostics ?? []),
  ...(store.project?.diagnostics ?? []),
]);
</script>

{#if store.error || actionError}
  <Callout layout="block" tone="destructive" text={actionError ?? store.error}>
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => void store.reloadFiles()}>Reload</Button
      >
    {/snippet}
  </Callout>
{/if}
{#each diagnostics as diagnostic, index (index)}
  <Callout
    layout="block"
    tone="warning"
    text={`${diagnostic.code}: ${diagnostic.path}${diagnostic.pointer}`}
  />
{/each}

{#if itemId}
  {#if open}
    {#key open.id}
      <ProfileDetail
        row={open}
        {store}
        {kind}
        {projectName}
        {models}
        {authProviders}
        {skills}
        {textDeps}
        onBack={() => onCloseItem?.()}
        onOpen={(id) => onOpenItem?.(id)}
        {onOpenFile}
      />
    {/key}
  {:else if store.loaded}
    <PageEmptyState
      variant="card"
      title="Profile not found"
      description={`No profile is registered as “${itemId}”.`}
    />
  {/if}
{:else if store.loaded}
  <ProfilesList
    {store}
    {kind}
    {projectName}
    {textDeps}
    onOpen={(id) => onOpenItem?.(id)}
    onNew={(layer) => void create(layer)}
    onDuplicate={(row) => void duplicate(row)}
  />
{/if}
