<!--
  Settings → Extensions: the extensions as origin groups (project, user,
  built-in) with a User and a project switch per row, and the detail view of
  one extension when `itemId` names it. Opening the page re-reads the installed
  extensions; Reload in the page header does it again.
-->
<script lang="ts">
import {
  PageEmptyState,
  PageItem,
} from "@nervekit/ui-kit/components/composites/page";
import { isProjectLocked } from "$lib/application/agent-configuration/project-lock";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import { visibleAccounts } from "../accounts/accounts-view";
import Blocks from "@lucide/svelte/icons/blocks";
import { tick } from "svelte";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import type {
  ExtensionCatalogEntry,
  ExtensionView,
} from "@nervekit/contracts/extensions";
import type { AuthProviderMetadata, ModelInfo } from "$lib/api";
import { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  LayerSwitches,
  OriginGroup,
  TrustStateBadge,
  type SettingsLayer,
} from "$lib/presentation/settings";
import { settingsSectionDomId } from "$lib/presentation/settings/section-id";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import { accountOptions } from "../tools/tool-settings";
import { applyLayerChange } from "../../shared/layer-change";
import {
  onConfigurationDecision,
  openConfigurationReview,
} from "$lib/application/configuration-review/configuration-review-queue.svelte";
import ExtensionMark from "./ExtensionMark.svelte";
import ExtensionDetail from "./ExtensionDetail.svelte";
import ExtensionDetailHeader from "./ExtensionDetailHeader.svelte";
import ExtensionsTrustNotice from "./ExtensionsTrustNotice.svelte";
import type { ExtensionsPageController } from "./extensions-page-controller.svelte";
import {
  entryWithEnabled,
  extensionFix,
  extensionProblem,
  extensionSummary,
  installedEntries,
  installedProblem,
  installedStateBadge,
  installedSummary,
} from "./extensions-view";

type Props = {
  /** The open project; without one the page has a single (User) column. */
  projectId?: string;
  projectName?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  /** The open extension; "" shows the list. */
  itemId?: string;
  /** Section a deep link asks for once the item has loaded. */
  sectionId?: string;
  onOpenItem?: (id: string, section?: string) => void;
  /** Leaves the open extension for the list. */
  onCloseItem?: () => void;
  /** Pages an extension contributes to the open project. */
  pagesOf?: (extensionId: string) => { id: string; label: string }[];
  onOpenPage?: (extensionId: string, pageId: string) => void;
  /** Receives the page's Reload action for the page header. */
  controller?: ExtensionsPageController;
};

let {
  projectId,
  projectName,
  models = [],
  authProviders = [],
  itemId = "",
  sectionId,
  onOpenItem,
  onCloseItem,
  pagesOf,
  onOpenPage,
  controller,
}: Props = $props();

const layered = $derived(!!projectId && !!projectName);
const userExt = new ScopedExtensionsState();
const projectExt = new ScopedExtensionsState();
/** The state the page lists: the project's (which also resolves User) or User's. */
const extensions = $derived(layered ? projectExt : userExt);
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void userExt.load({ scope: "user" });
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !projectId) return;
  void projectExt.load({ scope: "project", projectId });
});
$effect(() => userExt.observe());
$effect(() => projectExt.observe());
function reloadViews() {
  return Promise.all([userExt.reload(), layered ? projectExt.reload() : null]);
}
// Availability follows accounts and their credentials.
$effect(() => {
  const stop = [
    // Other settings (models, providers) feed availability too.
    onEvent("settings.updated", () => void reloadViews()),
    onEvent("accounts.changed", () => void reloadViews()),
    onEvent("accounts.health_changed", () => void reloadViews()),
  ];
  return () => stop.forEach((off) => off());
});

// Opening the page re-reads the installed extensions once; the header's
// Reload does it again.
let reloadedOnOpen = false;
$effect(() => {
  if (!extensions.view || reloadedOnOpen) return;
  reloadedOnOpen = true;
  void extensions.reloadInstalled();
});
$effect(() => {
  if (!controller) return;
  controller.reload = async () => {
    await extensions.reloadInstalled();
    if (layered) await userExt.reload();
  };
  return () => (controller.reload = undefined);
});

const view = $derived(extensions.view);
const userView = $derived(userExt.view);
const accounts = $derived(
  accountOptions(
    visibleAccounts(accountsState.accounts, projectId),
    accountsState.kinds,
  ),
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const catalog = $derived(view?.catalog ?? []);
const registered = $derived(
  new Map(
    (view?.extensions ?? []).map((extension) => [
      extension.metadata.id,
      extension,
    ]),
  ),
);
/** The project's extension settings file is not trusted: its column is locked. */
const locked = $derived(layered && isProjectLocked(projectExt.view?.file));
const busy = $derived(extensions.saving || !view);
const open = $derived(
  itemId
    ? view?.extensions.find((extension) => extension.metadata.id === itemId)
    : undefined,
);
const openInherited = $derived(
  open
    ? userView?.extensions.find(
        (extension) => extension.metadata.id === open.metadata.id,
      )
    : undefined,
);
let listElement = $state<HTMLElement>();
/** Review opens the shared review dialog on the extension. */
function review(entry: ExtensionCatalogEntry): void {
  const target = extensions.reviewTarget(entry);
  if (target) openConfigurationReview([target]);
}
// A decision in the review dialog loads or unloads the extension.
$effect(() =>
  onConfigurationDecision((decided) => {
    if (decided.target.kind === "extension") void reloadViews();
  }),
);

type Origin = "project" | "user" | "builtin";
type Row = {
  id: string;
  name: string;
  origin: Origin;
  /** Loaded extensions have a view; the rest wait for consent or failed. */
  loaded?: ExtensionView;
  entry?: ExtensionCatalogEntry;
};
const origins = $derived<Origin[]>(
  layered ? ["project", "user", "builtin"] : ["user", "builtin"],
);
function rowsOf(origin: Origin): Row[] {
  if (origin === "builtin")
    return (view?.extensions ?? [])
      .filter((extension) => extension.metadata.source === "builtin")
      .map((extension) => ({
        id: extension.metadata.id,
        name: extension.metadata.name,
        origin,
        loaded: extension,
      }));
  return installedEntries(catalog, origin).map((entry) => ({
    id: entry.id,
    name: entry.name ?? entry.id,
    origin,
    entry,
    loaded: entry.state === "enabled" ? registered.get(entry.id) : undefined,
  }));
}
const empty = {
  project: [
    "No project extensions",
    "Add a folder under .nerve/extensions in the project.",
  ],
  user: [
    "No user extensions",
    "Ask the agent to create one, or add a folder under agent/extensions in your Nerve home.",
  ],
} as const;

function layerValue(row: Row) {
  const user = userView?.extensions.find((e) => e.metadata.id === row.id);
  const project = layered ? row.loaded : undefined;
  const userOn =
    (row.origin === "project" ? undefined : user?.enabled.value) ?? false;
  return {
    user: userOn,
    project: project ? project.enabled.value : userOn,
    projectSet: project?.stored?.enabled !== undefined && !locked,
    value: {
      builtinDefault: row.loaded?.metadata.enabledByDefault ?? false,
      user: row.origin === "project" ? undefined : user?.stored?.enabled,
      project: project?.stored?.enabled,
    },
  };
}
async function writeEnabled(
  layer: SettingsLayer,
  id: string,
  choice: boolean | undefined,
) {
  const state = layer === "user" ? userExt : projectExt;
  const current = state.view?.extensions.find((e) => e.metadata.id === id);
  if (!current) return;
  if (choice === undefined) await state.reset(id, ["enabled"]);
  else await state.save(id, entryWithEnabled(current, choice));
}
function toggle(row: Row, layer: SettingsLayer, next: boolean) {
  void applyLayerChange({
    value: layerValue(row).value,
    layer,
    next,
    writeUser: (choice) => writeEnabled("user", row.id, choice),
    writeProject: (choice) => writeEnabled("project", row.id, choice),
  });
}
const openLayers = $derived(
  open
    ? layerValue({
        id: open.metadata.id,
        name: open.metadata.name,
        origin:
          open.metadata.source === "project"
            ? "project"
            : open.metadata.source === "user"
              ? "user"
              : "builtin",
        loaded: open,
      })
    : undefined,
);

// The shell scrolls to a deep-linked section when the detail opens, which can
// be before the extension view has loaded. Scroll again once it has.
let revealed = "";
$effect(() => {
  const key = open && sectionId ? `${itemId}/${sectionId}` : "";
  if (!key) {
    revealed = "";
    return;
  }
  if (revealed === key) return;
  revealed = key;
  const section = sectionId!;
  void tick().then(() =>
    document
      .getElementById(settingsSectionDomId(section))
      ?.scrollIntoView({ block: "start", behavior: "instant" }),
  );
});

// Back from a detail returns focus to the row that opened it.
let lastItem = "";
$effect(() => {
  const now = itemId;
  const previous = lastItem;
  lastItem = now;
  if (now || !previous || !view) return;
  const label = `Open ${view.extensions.find((e) => e.metadata.id === previous)?.metadata.name}`;
  void tick().then(() =>
    [...(listElement?.querySelectorAll<HTMLElement>("button") ?? [])]
      .find((button) => button.getAttribute("aria-label") === label)
      ?.focus({ preventScroll: true }),
  );
});
</script>

{#if itemId && onCloseItem}
  <!-- The detail's page header; the shell leaves this slot to it. -->
  <ExtensionDetailHeader
    parentLabel="Extensions"
    {itemId}
    extension={open}
    busy={busy || open?.readOnly === true}
    onBack={onCloseItem}
    onEnabledChange={(next) =>
      open && void extensions.save(itemId, entryWithEnabled(open, next))}
    layers={open && openLayers && layered
      ? {
          projectName: projectName!,
          user: openLayers.user,
          project: openLayers.project,
          projectSet: openLayers.projectSet,
          projectOnly: open.metadata.source === "project",
          locked,
          onChange: (layer, next) =>
            toggle(
              {
                id: open.metadata.id,
                name: open.metadata.name,
                origin:
                  open.metadata.source === "project"
                    ? "project"
                    : open.metadata.source === "user"
                      ? "user"
                      : "builtin",
                loaded: open,
              },
              layer,
              next,
            ),
        }
      : undefined}
  />
{/if}
{#if layered}<ExtensionsTrustNotice {extensions} />{/if}
{#if extensions.error}
  <Callout layout="block" tone="destructive" text={extensions.error}>
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => void extensions.reload()}>Reload</Button
      >
    {/snippet}
  </Callout>
{/if}
{#each view?.diagnostics.filter((d) => d.code === "file-unavailable") ?? [] as diagnostic (diagnostic.message)}
  <Callout layout="block" tone="destructive" text={diagnostic.message} />
{/each}

{#if !view}
  {#if !extensions.error}<Skeleton class="h-10 w-full" />{/if}
{:else if itemId}
  {#if open}
    <ExtensionDetail
      extension={open}
      installed={catalog.find(
        (entry) =>
          entry.id === open.metadata.id &&
          entry.source === open.metadata.source,
      )}
      inherited={layered ? openInherited : undefined}
      scope={layered ? "project" : "user"}
      {projectId}
      {projectName}
      {extensions}
      userExtensions={userExt}
      {accounts}
      models={usableModels}
      imageModels={view?.imageModels ?? []}
      pages={pagesOf?.(open.metadata.id) ?? []}
      onOpenPage={onOpenPage
        ? (pageId) => onOpenPage(open.metadata.id, pageId)
        : undefined}
    />
  {:else}
    <PageEmptyState
      variant="card"
      icon={Blocks}
      title="Extension not found"
      description={`No extension is registered as “${itemId}”.`}
    />
  {/if}
{:else}
  <div bind:this={listElement} class="grid min-w-0 gap-6">
    {#each origins as origin (origin)}
      {@const rows = rowsOf(origin)}
      <OriginGroup
        origin={{ kind: origin }}
        count={rows.length}
        projectName={layered ? projectName : undefined}
        {locked}
        emptyText={origin === "builtin" ? undefined : empty[origin][0]}
        emptyDescription={origin === "builtin" ? undefined : empty[origin][1]}
      >
        {#each rows as row (`${origin}/${row.entry?.path ?? row.id}`)}
          {@const loaded = row.loaded}
          {@const entry = row.entry}
          {@const layers = layerValue(row)}
          {@const waiting = entry?.state === "pending_consent"}
          {@const declined = waiting && entry?.trustState === "declined"}
          {@const badge =
            entry && !waiting ? installedStateBadge(entry.state) : undefined}
          {@const fix = loaded
            ? extensionFix(loaded, accounts, accountsState.kinds)
            : undefined}
          <PageItem
            title={row.name}
            summary={loaded
              ? extensionSummary(loaded, accounts)
              : entry
                ? installedSummary(entry)
                : undefined}
            mono={!loaded && !!entry}
            problem={loaded
              ? extensionProblem(loaded)
              : entry && !declined
                ? installedProblem(entry)
                : undefined}
            problemAction={waiting && !declined && entry?.consent
              ? { label: "Review", onclick: () => review(entry) }
              : fix
                ? {
                    label: fix.label,
                    onclick: () => onOpenItem?.(row.id, fix.section),
                  }
                : undefined}
            muted={!!entry && entry.state !== "enabled"}
            onOpen={loaded && onOpenItem
              ? () => onOpenItem(row.id)
              : waiting && entry?.consent
                ? () => review(entry)
                : undefined}
            openLabel={loaded ? `Open ${row.name}` : `Review ${row.name}`}
          >
            {#snippet leading()}
              {#if loaded}
                <ExtensionMark
                  icon={loaded.metadata.icon}
                  off={!loaded.enabled.value}
                />
              {:else}
                <Blocks
                  class="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              {/if}
            {/snippet}
            {#snippet badges()}
              {#if declined}<TrustStateBadge state="declined" />{/if}
              {#if badge}<Badge variant={badge.variant}>{badge.label}</Badge
                >{/if}
            {/snippet}
            {#snippet meta()}
              <LayerSwitches
                name={row.name}
                user={layers.user}
                project={layers.project}
                projectSet={layers.projectSet}
                projectName={layered ? projectName : undefined}
                projectOnly={origin === "project"}
                pending={!loaded}
                {locked}
                onChange={(layer, next) => toggle(row, layer, next)}
              />
            {/snippet}
          </PageItem>
        {/each}
      </OriginGroup>
    {/each}
  </div>
{/if}
