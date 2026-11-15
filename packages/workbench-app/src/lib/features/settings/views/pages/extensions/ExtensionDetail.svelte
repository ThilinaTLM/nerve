<!--
  One extension's detail view, below its page header
  (`ExtensionDetailHeader`): the problem callout, Account, the settings its schema
  declares, Features (what the agent can use, with the switches that belong to
  one namespace moved onto its row), then the account lists that did not merge.
  An account field that is its kind's only one is the Account section instead:
  the list of accounts with a radio each, before Settings.
-->
<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Code from "@lucide/svelte/icons/code";
import Library from "@lucide/svelte/icons/library";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Wrench from "@lucide/svelte/icons/wrench";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { tick } from "svelte";
import type { ModelInfo } from "$lib/api";
import type { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import {
  openProjectSettingsPane,
  openSettingsPane,
} from "$lib/application/settings";
import {
  SettingsChangeIndicator,
  SettingsItem,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/settings";
import { settingsSectionDomId } from "$lib/presentation/settings/section-id";
import AccountsSection from "./AccountsSection.svelte";
import ExtensionFieldRow from "./ExtensionFieldRow.svelte";
import {
  detailLayout,
  entryWithSetting,
  extensionChanges,
  extensionProblem,
  helperNote,
  lockOwner,
  type FeatureRow,
  type AccountChoices,
  type ExtensionsScope,
} from "./extensions-view";

type Props = {
  extension: ExtensionView;
  /** The user's view of the same extension, while a project is shown. */
  inherited?: ExtensionView;
  scope: ExtensionsScope;
  projectId?: string;
  extensions: ScopedExtensionsState;
  accounts: AccountChoices;
  models?: ModelInfo[];
};

let {
  extension,
  inherited,
  scope,
  projectId,
  extensions,
  accounts,
  models = [],
}: Props = $props();

const id = $derived(extension.metadata.id);
const layout = $derived(detailLayout(extension, scope));
const sections = $derived(layout.sections);
const changes = $derived(
  extensionChanges(extension, scope, accounts, inherited),
);
const problem = $derived(extensionProblem(extension));
// The callout above already gives this reason; the row only marks itself.
const rowProblem = (reason: string | undefined) =>
  reason !== undefined && reason === problem ? "Unavailable" : reason;
const note = $derived(helperNote(layout.helpers));
const hasFeatures = $derived(layout.features.length > 0);
const busy = $derived(extensions.saving || extension.readOnly);
const mergedKinds = $derived(
  new Set(layout.accounts.map((entry) => entry.kind)),
);
const kindLabels = $derived(
  Object.fromEntries(extension.accountKinds.map((k) => [k.kind, k.label])),
);
const listKinds = $derived(
  extension.accountKinds.filter((kind) => !mergedKinds.has(kind.kind)),
);
const featureIcons = { namespace: Code, tool: Wrench, skill: Library } as const;
const featureKindLabels = {
  namespace: "Quick script namespace",
  tool: "Direct tool",
  skill: "Skill",
} as const;

let advancedOpen = $state<Record<string, boolean>>({});

function openUserAccounts(): void {
  void openSettingsPane("extensions", { item: id, section: "accounts" });
}
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
        readonly={scope === "project"}
        onManage={openUserAccounts}
        choice={{
          title: entry.item.field.label,
          description: entry.item.field.description,
          scope,
          value:
            typeof entry.item.value === "string" ? entry.item.value : undefined,
          disabled: busy || !entry.item.editable,
          lockedReason: entry.item.readOnlyReason,
          change: changes.find((change) => change.key === entry.item.key),
          onSelect: (account) =>
            void extensions.save(
              id,
              entryWithSetting(extension, entry.item.key, account),
            ),
          onReset: () => void extensions.reset(id, [entry.item.key]),
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
    >
      {#each section.fields as item (item.key)}
        <ExtensionFieldRow
          extensionId={id}
          {item}
          {scope}
          {accounts}
          {kindLabels}
          {models}
          change={changes.find((change) => change.key === item.key)}
          disabled={busy}
          onChange={(value) =>
            void extensions.save(
              id,
              entryWithSetting(extension, item.key, value),
            )}
          onReset={() => void extensions.reset(id, [item.key])}
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
                {item}
                {scope}
                {accounts}
                {kindLabels}
                {models}
                change={changes.find((change) => change.key === item.key)}
                disabled={busy}
                onChange={(value) =>
                  void extensions.save(
                    id,
                    entryWithSetting(extension, item.key, value),
                  )}
                onReset={() => void extensions.reset(id, [item.key])}
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
      description="What the agent gets when this extension is on."
    >
      <SettingsList ariaLabel="Features">
        {#each layout.features as row (`${row.kind}:${row.id}`)}
          {@const control = row.control}
          {@const item = control.type === "switch" ? control.item : undefined}
          <SettingsItem
            title={row.title}
            summary={row.summary}
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
            checked={item ? item.value === true : undefined}
            switchLabel={item?.field.label}
            disabled={busy || (item ? !item.editable : false)}
            lockedBy={item ? lockOwner(item) : undefined}
            onCheckedChange={item
              ? (next) =>
                  void extensions.save(
                    id,
                    entryWithSetting(extension, item.key, next),
                  )
              : undefined}
          >
            {#snippet meta()}
              {#if item}
                {@const change = changes.find(
                  (entry) => entry.key === item.key,
                )}
                {#if change}
                  <SettingsChangeIndicator
                    {scope}
                    from={change.from}
                    onReset={() => void extensions.reset(id, [item.key])}
                  />
                {/if}
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
                <span class="text-caption text-muted-foreground"
                  >With the extension</span
                >
              {/if}
            {/snippet}
          </SettingsItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/if}
  {#if listKinds.length > 0}
    {#if scope === "user"}
      {#each listKinds as kind (kind.kind)}
        <AccountsSection {kind} icon={extension.metadata.icon} />
      {/each}
    {:else}
      <SettingsSection id="accounts" title="Accounts" divided>
        <SettingsRow
          label="Managed in user settings"
          description="Accounts and their credentials are shared by every project."
        >
          {#snippet control()}
            <Button size="sm" variant="outline" onclick={openUserAccounts}
              >Open user settings</Button
            >
          {/snippet}
        </SettingsRow>
      </SettingsSection>
    {/if}
  {/if}
</div>
