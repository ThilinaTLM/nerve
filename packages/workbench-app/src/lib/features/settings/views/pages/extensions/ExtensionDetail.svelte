<!--
  One extension's detail view, below its page header
  (`ExtensionDetailHeader`): the problem callout, Account, the settings its schema
  declares, Features (what the agent can use, with the switches that belong to
  one namespace moved onto its row), then the account lists that did not merge.
  An account field that is its kind's only one is the Account section instead:
  the list of accounts with a radio each, before Settings.
-->
<script lang="ts">
import {
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import type { ExtensionsView } from "@nervekit/contracts/extensions";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Library from "@lucide/svelte/icons/library";
import PanelTop from "@lucide/svelte/icons/panel-top";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Wrench from "@lucide/svelte/icons/wrench";
import Zap from "@lucide/svelte/icons/zap";
import type {
  ExtensionCatalogEntry,
  ExtensionView,
} from "@nervekit/contracts/extensions";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { tick } from "svelte";
import type { ModelInfo } from "$lib/api";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import type { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import {
  ColumnLabels,
  LayerSwitches,
  SettingsSection,
  SplitColumns,
  type SettingsLayer,
} from "$lib/presentation/settings";
import { settingsSectionDomId } from "$lib/presentation/settings/section-id";
import AccountsSection from "./AccountsSection.svelte";
import ExtensionFieldRow, {
  type FieldLayers,
} from "./ExtensionFieldRow.svelte";
import { applyLayerChange } from "../../shared/layer-change";
import ExtensionInstalledSections from "./ExtensionInstalledSections.svelte";
import {
  detailLayout,
  entryWithSetting,
  eligibleKindLabels,
  displayValue,
  extensionChanges,
  extensionProblem,
  helperNote,
  lockOwner,
  type FeatureRow,
  type FieldItem,
  type AccountChoices,
  type ExtensionsScope,
} from "./extensions-view";

type Props = {
  extension: ExtensionView;
  /** The catalog entry of an installed (user or project) extension. */
  installed?: ExtensionCatalogEntry;
  /** The user's view of the same extension, while a project is shown. */
  inherited?: ExtensionView;
  scope: ExtensionsScope;
  projectId?: string;
  /** The open project's name: settings fields get a User and a project cell. */
  projectName?: string;
  /** The User scope's state, which saves the User cells while `extensions` is the project's. */
  userExtensions?: ScopedExtensionsState;
  extensions: ScopedExtensionsState;
  accounts: AccountChoices;
  models?: ModelInfo[];
  /** The host's image generation models for `imageModel` fields. */
  imageModels?: ExtensionsView["imageModels"];
  /** Pages this extension contributes to the open project. */
  pages?: { id: string; label: string }[];
  onOpenPage?: (pageId: string) => void;
};

let {
  extension,
  installed,
  inherited,
  scope,
  projectId,
  projectName,
  userExtensions,
  extensions,
  accounts,
  models = [],
  imageModels = [],
  pages = [],
  onOpenPage,
}: Props = $props();

const id = $derived(extension.metadata.id);
const layout = $derived(detailLayout(extension, scope));
const sections = $derived(layout.sections);
const changes = $derived(
  extensionChanges(extension, scope, accounts, inherited),
);
const problem = $derived(extensionProblem(extension));
const layered = $derived(scope === "project" && !!projectName && !!inherited);
const userLayout = $derived(
  layered && inherited ? detailLayout(inherited, "user") : undefined,
);
const userItems = $derived(
  new Map(
    (userLayout?.sections ?? []).flatMap((section) =>
      [...section.fields, ...section.advanced].map(
        (item) => [item.key, item] as const,
      ),
    ),
  ),
);
const projectLocked = $derived(
  layered && (extensions.view?.file.trustState ?? "trusted") !== "trusted",
);
const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** A field's value changed at one layer; equal-to-inherited choices are dropped. */
async function changeField(
  item: FieldItem,
  layer: SettingsLayer,
  value: unknown,
): Promise<void> {
  if (!layered || !inherited || !userExtensions) {
    await (value === undefined
      ? extensions.reset(id, [item.key])
      : extensions.save(id, entryWithSetting(extension, item.key, value)));
    return;
  }
  const field = extension.settingsSchema.fields[item.key]!;
  const current = {
    builtinDefault: "default" in field ? field.default : undefined,
    user: inherited.stored?.settings[item.key],
    project: extension.stored?.settings[item.key],
  };
  await applyLayerChange({
    value: current,
    layer,
    next: value,
    equals: sameValue,
    writeUser: (choice) =>
      choice === undefined
        ? userExtensions.reset(id, [item.key])
        : userExtensions.save(
            id,
            entryWithSetting(
              userExtensions.view?.extensions.find(
                (e) => e.metadata.id === id,
              ) ?? inherited,
              item.key,
              choice,
            ),
          ),
    writeProject: (choice) =>
      choice === undefined
        ? extensions.reset(id, [item.key])
        : extensions.save(id, entryWithSetting(extension, item.key, choice)),
  });
}
/** The two cells of a settings field, or undefined without a project. */
function layersFor(item: FieldItem): FieldLayers | undefined {
  if (!layered || !inherited) return undefined;
  const userItem = userItems.get(item.key);
  const base = userItem ?? item;
  const field = item.field;
  const projectOnly = extension.metadata.source === "project";
  const userStored = inherited.stored?.settings[item.key];
  const projectStored = extension.stored?.settings[item.key];
  const text = (value: unknown) =>
    displayValue(field, value, accounts) ?? "Not set";
  const defaultValue = "default" in field ? field.default : undefined;
  return {
    projectName: projectName!,
    userItem: projectOnly ? undefined : userItem,
    locked: projectLocked,
    projectOnly,
    onUserChange: (value) => void changeField(item, "user", value),
    userReset:
      userStored !== undefined && userItem?.editable
        ? {
            label: `Reset to default (${text(defaultValue)})`,
            onReset: () => void changeField(item, "user", undefined),
          }
        : undefined,
    projectReset:
      projectStored !== undefined && !projectLocked
        ? {
            label: `Use the User value (${text(base.value)})`,
            onReset: () => void changeField(item, "project", undefined),
          }
        : undefined,
  };
}
/** The User and project radio slots of an account setting, or undefined without a project. */
function accountLayers(item: FieldItem) {
  if (!layered || !inherited) return undefined;
  const userItem = userLayout?.accounts.find(
    (entry) => entry.item.key === item.key,
  )?.item;
  const userValue = userItem?.value;
  return {
    projectName: projectName!,
    userValue: typeof userValue === "string" ? userValue : undefined,
    userDisabled: busy || projectLocked || !userItem?.editable,
    locked: projectLocked,
    onSelectUser: (account: string) => void changeField(item, "user", account),
  };
}
// The callout above already gives this reason; the row only marks itself.
const rowProblem = (reason: string | undefined) =>
  reason !== undefined && reason === problem ? "Unavailable" : reason;
const note = $derived(helperNote(layout.helpers));
const hasFeatures = $derived(layout.features.length > 0);
const busy = $derived(extensions.saving || extension.readOnly);
const mergedKinds = $derived(
  new Set(layout.accounts.map((entry) => entry.kind)),
);
// The kinds the extension's account settings may select: its own and, for platforms it uses, every definition covering what it declared.
const kindLabels = $derived(eligibleKindLabels(extension, accountsState.kinds));
const listKinds = $derived(
  extension.accountKinds.filter((kind) => !mergedKinds.has(kind.kind)),
);
const featureIcons = { namespace: Zap, tool: Wrench, skill: Library } as const;
const featureKindLabels = {
  namespace: "Quick script",
  tool: "Tool",
  skill: "Skill",
} as const;
/** Names the row's kind first, so an extension reads as more than Quick script. */
function featureSummary(row: FeatureRow): string {
  const kind = featureKindLabels[row.kind];
  return row.summary ? `${kind} · ${row.summary}` : kind;
}

let advancedOpen = $state<Record<string, boolean>>({});

function revealSection(section: string): void {
  document
    .getElementById(settingsSectionDomId(section))
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}
/** Scrolls to the Settings field a Features row points at, opening Advanced if needed. */
async function revealField(sectionId: string, advanced: boolean) {
  if (advanced) advancedOpen[sectionId] = true;
  await tick();
  revealSection(sectionId);
}
function featureProblem(row: FeatureRow): string | undefined {
  return rowProblem(row.problem);
}
function openPage(page: "tools" | "skills"): void {
  if (projectId) void openProjectSettingsPane(projectId, page);
  else void openSettingsPane(page);
}
</script>

{#snippet helpersNote()}{note}{/snippet}

{#snippet splitLabels()}
  {#if projectName}
    <SplitColumns
      {projectName}
      projectOnly={extension.metadata.source === "project"}
      locked={projectLocked}
    />
  {/if}
{/snippet}

{#snippet layerLabels()}
  {#if projectName}
    <ColumnLabels
      {projectName}
      projectOnly={extension.metadata.source === "project"}
      locked={projectLocked}
      chevron
    />
  {/if}
{/snippet}

<div class="grid gap-5">
  {#if extension.readOnly}
    <Callout
      layout="block"
      tone="warning"
      text="This entry was written by a newer version of Nerve and cannot be edited here."
    />
  {/if}
  {#if problem}
    <Callout
      layout="block"
      tone="warning"
      icon={TriangleAlert}
      title="Unavailable"
      text={problem}
    />
  {/if}

  {#each layout.accounts as entry (entry.item.key)}
    {@const kind = extension.accountKinds.find((k) => k.kind === entry.kind)}
    {#if kind}
      <AccountsSection
        {kind}
        icon={extension.metadata.icon}
        {projectId}
        projectOnly={extension.metadata.source === "project"}
        choice={{
          title: entry.item.field.label,
          description: entry.item.field.description,
          scope,
          value:
            typeof entry.item.value === "string" ? entry.item.value : undefined,
          disabled: busy || projectLocked || !entry.item.editable,
          lockedReason: entry.item.readOnlyReason,
          change: changes.find((change) => change.key === entry.item.key),
          onSelect: (account) =>
            void changeField(entry.item, "project", account),
          onReset: () => void extensions.reset(id, [entry.item.key]),
          layers: accountLayers(entry.item),
        }}
      />
    {/if}
  {/each}

  {#each sections as section (section.id)}
    <SettingsSection
      id={section.id}
      title={section.title}
      description={section.description}
      divided
      splitLabels={layered ? splitLabels : undefined}
    >
      {#each section.fields as item (item.key)}
        <ExtensionFieldRow
          extensionId={id}
          {projectId}
          {item}
          {scope}
          {accounts}
          {kindLabels}
          {models}
          {imageModels}
          change={changes.find((change) => change.key === item.key)}
          disabled={busy}
          layers={layersFor(item)}
          onChange={(value) => void changeField(item, "project", value)}
          onReset={() => void changeField(item, "project", undefined)}
        />
      {/each}
      {#if section.advanced.length > 0}
        <Collapsible.Root
          open={advancedOpen[section.id] ?? false}
          onOpenChange={(open) => (advancedOpen[section.id] = open)}
        >
          <Collapsible.Trigger
            class="flex w-full items-center gap-1.5 px-3 py-2 text-ui text-muted-foreground hover:bg-hover"
          >
            <ChevronDown
              class={`size-3.5 transition-transform ${advancedOpen[section.id] ? "" : "-rotate-90"}`}
              aria-hidden="true"
            />
            Advanced
          </Collapsible.Trigger>
          <Collapsible.Content class="divide-y divide-border border-t">
            {#each section.advanced as item (item.key)}
              <ExtensionFieldRow
                extensionId={id}
                {projectId}
                {item}
                {scope}
                {accounts}
                {kindLabels}
                {models}
                {imageModels}
                change={changes.find((change) => change.key === item.key)}
                disabled={busy}
                layers={layersFor(item)}
                onChange={(value) => void changeField(item, "project", value)}
                onReset={() => void changeField(item, "project", undefined)}
              />
            {/each}
          </Collapsible.Content>
        </Collapsible.Root>
      {/if}
    </SettingsSection>
  {/each}

  {#if hasFeatures}
    <SettingsSection
      id="features"
      footer={note ? helpersNote : undefined}
      title="Features"
      description="The tools, Quick script namespaces and skills the agent gets when this extension is on."
      layerLabels={layered ? layerLabels : undefined}
    >
      <PageList ariaLabel="Features">
        {#each layout.features as row (`${row.kind}:${row.id}`)}
          {@const control = row.control}
          {@const item = control.type === "switch" ? control.item : undefined}
          <PageItem
            title={row.title}
            summary={featureSummary(row)}
            icon={featureIcons[row.kind]}
            iconLabel={`${featureKindLabels[row.kind]} · ${row.id}`}
            muted={!extension.enabled.value}
            problem={featureProblem(row)}
            onOpen={control.type === "opens"
              ? () => openPage(control.page)
              : undefined}
            openLabel={control.type === "opens"
              ? `Open ${row.title} in ${control.page === "tools" ? "Tools" : "Skills"}`
              : undefined}
            checked={item && !layered ? item.value === true : undefined}
            switchLabel={item?.field.label}
            disabled={busy || (item ? !item.editable : false)}
            lockedBy={item ? lockOwner(item) : undefined}
            onCheckedChange={item && !layered
              ? (next) => void changeField(item, "project", next)
              : undefined}
          >
            {#snippet meta()}
              {#if item && layered}
                {@const userItem = userItems.get(item.key)}
                <LayerSwitches
                  name={row.title}
                  user={userItem
                    ? userItem.value === true
                    : item.value === true}
                  project={item.value === true}
                  projectSet={item.set && !projectLocked}
                  {projectName}
                  projectOnly={extension.metadata.source === "project"}
                  locked={projectLocked}
                  onChange={(layer, next) =>
                    void changeField(item, layer, next)}
                />
              {:else if control.type === "setting"}
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-muted-foreground"
                  onclick={() =>
                    void revealField(control.sectionId, control.advanced)}
                  >{control.on ? "On" : "Off"} · set in Settings</Button
                >
              {:else if control.type === "follows"}
                <span
                  class={[
                    layered ? "w-48" : "w-24",
                    "text-center text-caption text-muted-foreground",
                  ]}>Always on</span
                >
              {/if}
            {/snippet}
          </PageItem>
        {/each}
      </PageList>
    </SettingsSection>
  {/if}
  {#if pages.length > 0}
    <SettingsSection
      id="pages"
      title="Pages"
      description="Pages this extension adds to the open project. Each opens in its own tab."
    >
      <PageList ariaLabel="Pages">
        {#each pages as page (page.id)}
          <PageItem
            title={page.label}
            summary="Page"
            icon={PanelTop}
            muted={!extension.enabled.value}
            onOpen={onOpenPage ? () => onOpenPage(page.id) : undefined}
            openLabel={`Open ${page.label}`}
          />
        {/each}
      </PageList>
    </SettingsSection>
  {/if}
  {#each listKinds as kind (kind.kind)}
    <AccountsSection
      {kind}
      icon={extension.metadata.icon}
      {projectId}
      projectOnly={extension.metadata.source === "project"}
    />
  {/each}
  {#if installed}
    <ExtensionInstalledSections entry={installed} {extensions} />
  {/if}
</div>
