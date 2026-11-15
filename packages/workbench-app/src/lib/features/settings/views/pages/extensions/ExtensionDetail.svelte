<!--
  One extension's detail view, below its page header
  (`ExtensionDetailHeader`): the problem callout, the settings its schema
  declares, Features (what the agent can use, with the switches that belong to
  one namespace moved onto its row), then Accounts.
-->
<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
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
import { SettingsRow, SettingsSection } from "$lib/presentation/settings";
import { settingsSectionDomId } from "$lib/presentation/settings/section-id";
import AccountsSection from "./AccountsSection.svelte";
import ExtensionFieldRow from "./ExtensionFieldRow.svelte";
import {
  detailLayout,
  entryWithSetting,
  extensionChanges,
  extensionFix,
  extensionProblem,
  helperNote,
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
const fix = $derived(extensionFix(extension, accounts));
const note = $derived(helperNote(layout.helpers));
const contributes = $derived(extension.metadata.contributes);
const hasFeatures = $derived(
  layout.features.length +
    contributes.tools.length +
    contributes.skills.length >
    0,
);
const busy = $derived(extensions.saving || extension.readOnly);
const hasAccounts = $derived(extension.accountKinds.length > 0);

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
function runFix(): void {
  if (!fix) return;
  if (fix.section === "accounts" && scope === "project") openUserAccounts();
  else revealSection(fix.section);
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
    >
      {#snippet actions()}
        {#if fix}
          <Button size="sm" variant="outline" onclick={runFix}
            >{fix.label}</Button
          >
        {/if}
      {/snippet}
    </Callout>
  {/if}

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
      description="What the agent can use in quick_script when this extension is on."
      divided
    >
      {#each layout.features as row (row.id)}
        {#if row.control.type === "switch"}
          {@const item = row.control.item}
          <ExtensionFieldRow
            extensionId={id}
            {item}
            {scope}
            {accounts}
            {models}
            feature={{ ...row, problem: rowProblem(row.problem) }}
            change={changes.find((change) => change.key === item.key)}
            disabled={busy}
            onChange={(value) =>
              void extensions.save(
                id,
                entryWithSetting(extension, item.key, value),
              )}
            onReset={() => void extensions.reset(id, [item.key])}
          />
        {:else}
          {@const mode = row.control}
          <SettingsRow label={row.id} mono description={row.summary}>
            {#snippet hint()}
              {#if row.problem}
                <span class="inline-flex items-center gap-1 text-warning">
                  <TriangleAlert class="size-3 flex-none" aria-hidden="true" />
                  {rowProblem(row.problem)}
                </span>
              {/if}
            {/snippet}
            {#snippet control()}
              {#if mode.type === "setting"}
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-muted-foreground"
                  onclick={() =>
                    void revealField(mode.sectionId, mode.advanced)}
                  >{mode.on ? "On" : "Off"} · set in Settings</Button
                >
              {:else}
                <span class="text-ui text-muted-foreground"
                  >With the extension</span
                >
              {/if}
            {/snippet}
          </SettingsRow>
        {/if}
      {/each}
      {#if contributes.tools.length > 0}
        <SettingsRow
          label="Direct tools"
          description={contributes.tools.join(", ")}
        >
          {#snippet control()}
            <Button size="sm" variant="ghost" onclick={() => openPage("tools")}
              >Open Tools</Button
            >
          {/snippet}
        </SettingsRow>
      {/if}
      {#if contributes.skills.length > 0}
        <SettingsRow label="Skills" description={contributes.skills.join(", ")}>
          {#snippet control()}
            <Button size="sm" variant="ghost" onclick={() => openPage("skills")}
              >Open Skills</Button
            >
          {/snippet}
        </SettingsRow>
      {/if}
    </SettingsSection>
  {/if}
  {#if hasAccounts}
    {#if scope === "user"}
      {#each extension.accountKinds as kind (kind.kind)}
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
