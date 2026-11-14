<!--
  One extension's detail view: header, the settings its schema declares,
  its accounts, and what it contributes. The breadcrumb replaces the page
  header, so this renders its own.
-->
<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
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
import { extensionIcon } from "./extension-icons";
import {
  entryWithEnabled,
  entryWithSetting,
  extensionChanges,
  extensionFix,
  extensionProblem,
  fieldSections,
  contributedNamespaces,
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
const Icon = $derived(extensionIcon(extension.metadata.icon));
const sections = $derived(fieldSections(extension, scope));
const changes = $derived(
  extensionChanges(extension, scope, accounts, inherited),
);
const problem = $derived(extensionProblem(extension));
const fix = $derived(extensionFix(extension, accounts));
const namespaces = $derived(contributedNamespaces(extension));
const contributes = $derived(extension.metadata.contributes);
const hasContributions = $derived(
  namespaces.length + contributes.tools.length + contributes.skills.length > 0,
);

// Opening a detail unmounts the row that was clicked; focus the heading so
// Escape and keyboard users stay inside the settings view.
let heading = $state<HTMLElement>();
$effect(() => heading?.focus({ preventScroll: true }));
const locked = $derived(extension.enabled.source.locked === true);
const busy = $derived(extensions.saving || extension.readOnly);
const hasAccounts = $derived(extension.accountKinds.length > 0);

let advancedOpen = $state<Record<string, boolean>>({});
let accountSections = $state<Record<string, { openAdd: () => void }>>({});

function openUserAccounts(): void {
  void openSettingsPane("extensions", { item: id, section: "accounts" });
}
function addAccount(kind: string): void {
  if (scope === "project") return openUserAccounts();
  accountSections[kind]?.openAdd();
}
function revealSection(section: string): void {
  document
    .getElementById(settingsSectionDomId(section))
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
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

<div class="grid gap-5">
  <header class="flex items-start gap-3">
    <span
      class="flex size-8 flex-none items-center justify-center rounded-md border bg-card text-foreground"
    >
      <Icon class="size-4" aria-hidden="true" />
    </span>
    <div class="grid min-w-0 flex-1 gap-0.5">
      <h2
        bind:this={heading}
        tabindex="-1"
        class="truncate text-title font-medium text-foreground outline-none"
      >
        {extension.metadata.name}
      </h2>
      <p class="text-caption text-muted-foreground">
        {extension.metadata.description}
      </p>
    </div>
    <div class="flex flex-none items-center gap-2">
      <Switch
        checked={extension.enabled.value}
        disabled={busy || locked}
        aria-label={`Enable ${extension.metadata.name}`}
        onCheckedChange={(next) =>
          void extensions.save(id, entryWithEnabled(extension, next))}
      />
    </div>
  </header>

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
          onAddAccount={() =>
            item.field.type === "account" && addAccount(item.field.kind)}
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
                onAddAccount={() =>
                  item.field.type === "account" && addAccount(item.field.kind)}
              />
            {/each}
          </Collapsible.Content>
        </Collapsible.Root>
      {/if}
    </SettingsSection>
  {/each}

  {#if hasAccounts}
    {#if scope === "user"}
      {#each extension.accountKinds as kind (kind.kind)}
        <AccountsSection
          bind:this={accountSections[kind.kind]}
          {kind}
          icon={Icon}
        />
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

  {#if hasContributions}
    <SettingsSection
      id="contributes"
      title="Contributes"
      description="What the agent gets when this extension is on."
      divided
    >
      {#each namespaces as namespace (namespace.id)}
        {@const state = namespace.state}
        <SettingsRow
          label={namespace.id}
          mono
          description={`${namespace.summary} · ${
            !state || !state.configured
              ? "Not enabled"
              : state.available
                ? "Available"
                : state.reason
          }`}
        />
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
</div>
