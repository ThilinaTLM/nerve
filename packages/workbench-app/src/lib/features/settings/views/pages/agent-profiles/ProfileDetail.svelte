<!--
  One profile's inner page: Profile (label, ID, when to use, used as), then its
  Changes, each a row that opens its editor. Built-in profiles are read-only
  with Customize; a project profile waits for review before it applies.
-->
<script lang="ts">
import {
  FieldRow,
  PageEmptyState,
  PageHeader,
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import Bot from "@lucide/svelte/icons/bot";
import Copy from "@lucide/svelte/icons/copy";
import FileText from "@lucide/svelte/icons/file-text";
import Lock from "@lucide/svelte/icons/lock";
import LockOpen from "@lucide/svelte/icons/lock-open";
import Plus from "@lucide/svelte/icons/plus";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Users from "@lucide/svelte/icons/users";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button, buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import { accountsState } from "$lib/application/extensions/accounts-state.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import type { AuthProviderMetadata, AvailableSkill, ModelInfo } from "$lib/api";
import {
  LayerEnabledTable,
  LevelMenu,
  SettingsSection,
  TipBadge,
  TrustDecisionActions,
} from "$lib/presentation/settings";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import {
  skillOverrideKind,
  sortBySkillSource,
} from "$lib/domain/skills/skill-catalog";
import { visibleAccounts } from "../accounts/accounts-view";
import ConfigurationRepairDialog from "../capabilities/ConfigurationRepairDialog.svelte";
import { accountOptions, toolRows } from "../tools/tool-settings";
import ProfileChangeDialog from "./ProfileChangeDialog.svelte";
import ProfileTrustReviewDialog from "./ProfileTrustReviewDialog.svelte";
import {
  addableChanges,
  changeRows,
  changeSections,
  modeHint,
  unifyChangeMode,
  type AddChangeItem,
  type ChangeKey,
  type ChangeRow,
} from "./profile-changes";
import {
  seedChange,
  type ChangeDraft,
  type ProfileEditContext,
} from "./profile-edit-context";
import { profileRowId, type ProfileRow } from "./profile-groups";
import {
  changeRowLabel,
  changeValueText,
  type ChangeTextDeps,
} from "./profile-summary";
import type { ProfilesStore } from "./profiles-store.svelte";
import type { ProfileKind } from "./profile-kind";

let {
  row,
  store,
  kind,
  projectName,
  models = [],
  authProviders = [],
  skills = [],
  textDeps,
  onBack,
  onOpen,
  onOpenFile,
}: {
  row: ProfileRow;
  store: ProfilesStore;
  kind: ProfileKind;
  projectName?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  skills?: AvailableSkill[];
  textDeps: ChangeTextDeps;
  onBack: () => void;
  /** Opens another profile's detail (the copy that replaces this one). */
  onOpen: (id: string) => void;
  onOpenFile?: (path: string) => void;
} = $props();

const entry = $derived(row.entry);
const definition = $derived(entry.definition);
const readOnly = $derived(row.origin === "builtin");
const untrusted = $derived(
  row.origin === "project" && entry.trustState !== "trusted",
);
const busy = $derived(!!store.busy);
const error = $derived(store.errors[row.id]);
const editor = $derived(store.editorOf(row.origin));
const projectId = $derived(
  row.origin === "project" ? store.projectId : undefined,
);
const launch = $derived(store.launch(row));
const copy = $derived(
  row.replacedBy ? store.find(profileRowId("project", row.name)) : undefined,
);
const parentLabel = $derived(kind === "subagent" ? "Sub-Agents" : "Agents");

$effect(() => {
  if (projectId) void permissionRuleSetCatalog.ensure(projectId);
});
const rules = $derived(permissionRuleSetCatalog.summaries(projectId));
const leadProfiles = $derived(
  [...Object.values(store.rows("lead")).flat()]
    .filter(
      (p) => p.entry.definition && p.entry.definition.usableBy !== "subagent",
    )
    .map((p) => ({
      name: p.name,
      label: p.entry.definition?.label ?? p.name,
    })),
);
const context = $derived<ProfileEditContext>({
  models: authenticatedRealModelOptions(models, authProviders),
  permissionOptions: rules
    .filter((r) => r.enabled)
    .toSorted((a, b) => {
      const order = [
        "read_only",
        "planning",
        "baseline",
        "supervised",
        "autonomous",
      ];
      return (
        (a.source === "builtin" ? order.indexOf(a.id) : order.length) -
        (b.source === "builtin" ? order.indexOf(b.id) : order.length)
      );
    })
    .map((r) => ({ value: r.id, label: r.name, detail: r.description })),
  skills: skills.filter(
    (s) => row.origin === "project" || s.source !== "project",
  ),
  defaultPermission: editor.resolution?.settings.permissionRuleSetId,
  skillEnabled: (source, name) => {
    const resolved = editor.resolution?.settings.skills;
    return resolved?.[source]?.[name] ?? resolved?.defaults?.[source] ?? true;
  },
  accounts: accountOptions(
    visibleAccounts(accountsState.accounts, projectId),
    accountsState.kinds,
  ),
  seedTool: (tool) =>
    editor.resolution?.settings.tools?.[tool] ??
    resolveAgentConfiguration({ role: "lead" }).settings.tools?.[tool] ??
    {},
  leadProfiles,
});

const rows = $derived(definition ? changeRows(definition) : []);
const sections = $derived(changeSections(rows));
const addable = $derived(
  definition
    ? addableChanges({
        rows,
        tools: toolRows
          .filter(
            (t) =>
              definition.usableBy !== "subagent" ||
              (t.id !== "subagents" && t.id !== "plan_present"),
          )
          .map((t) => ({
            key: `tool:${t.id}` as ChangeKey,
            label: t.label,
            defaultOn: t.always
              ? undefined
              : (context.seedTool(t.id).enabled ?? true),
          })),
        skills: sortBySkillSource(context.skills).map((skill) => ({
          key: `skill:${skillOverrideKind(skill.source)}:${skill.name}` as ChangeKey,
          label: skill.name,
          defaultOn: context.skillEnabled(
            skillOverrideKind(skill.source),
            skill.name,
          ),
        })),
      })
    : [],
);

// Profile fields save when they lose focus (or Enter in the label).
let label = $state("");
let whenToUse = $state("");
$effect(() => {
  label = definition?.label ?? "";
  whenToUse = definition?.whenToUse ?? "";
});
function saveHead(head: Parameters<ProfilesStore["saveHead"]>[1]) {
  void store.saveHead(row, head).catch(() => undefined);
}

const swallow = (action: () => Promise<unknown>) =>
  void action().catch(() => undefined);
const persist = (change: ChangeDraft) => store.persistChange(row, change);
const asDraft = (change: ChangeRow): ChangeDraft => ({
  key: change.key,
  mode: change.mode ?? "recommend",
  value: change.value,
});

let editing = $state<{ change: ChangeDraft; title: string }>();
let editorOpen = $state(false);
function openEditor(change: ChangeDraft, title: string) {
  editing = { change, title };
  editorOpen = true;
}
async function add(item: AddChangeItem) {
  if (item.opensEditor) {
    openEditor(seedChange(item.key, context), item.label);
    return;
  }
  const enabled = item.turnsTo === "On";
  const seed = item.key.startsWith("tool:")
    ? context.seedTool(
        item.key.slice(5) as Parameters<typeof context.seedTool>[0],
      )
    : undefined;
  await persist({
    key: item.key,
    mode: "recommend",
    value: seed ? { ...seed, enabled } : enabled,
  });
}

let deleteOpen = $state(false);
let reviewOpen = $state(false);
let repairOpen = $state(false);
const repairReplacement = $derived(
  definition ?? {
    schemaVersion: 1,
    name: row.name,
    whenToUse: "Use when recovering this profile.",
    usableBy: kind,
    instructions: "",
  },
);
async function customize(layer: "user" | "project") {
  try {
    onOpen(await store.customize(row, layer));
  } catch (cause) {
    store.errors[row.id] =
      cause instanceof Error ? cause.message : String(cause);
  }
}
async function duplicate() {
  try {
    onOpen(await store.duplicate(row));
  } catch (cause) {
    store.errors[row.id] =
      cause instanceof Error ? cause.message : String(cause);
  }
}
async function remove() {
  if (await store.remove(row)) onBack();
}
async function decide(trusted: boolean) {
  if (await store.trust(row, trusted)) reviewOpen = false;
}
</script>

{#snippet addMenu(primary: boolean)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={buttonVariants({
        variant: primary ? "default" : "outline",
        size: "sm",
      })}
      disabled={busy || addable.length === 0}
    >
      <Plus class="size-3.5" />Add a change
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="max-h-80 w-60 overflow-y-auto">
      {#each addable as group, index (group.group)}
        {#if index > 0}<DropdownMenu.Separator />{/if}
        <GroupLabel label={group.group} class="px-2 py-1" />
        {#each group.items as item (item.key)}
          <DropdownMenu.Item onSelect={() => swallow(() => add(item))}>
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
            {#if item.turnsTo}
              <span class="flex-none text-muted-foreground">{item.turnsTo}</span
              >
            {/if}
          </DropdownMenu.Item>
        {/each}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<PageHeader
  title={definition?.label ?? row.name}
  description={definition?.whenToUse}
  parent={{ label: parentLabel, onBack }}
>
  {#snippet leading()}
    {#if kind === "subagent"}<Users class="size-4" />{:else}<Bot
        class="size-4"
      />{/if}
  {/snippet}
  {#snippet below()}
    <!-- Labelled outline buttons under the description: the title row stays free of controls. -->
    <div class="flex flex-wrap items-center gap-2 pt-2">
      {#if definition}
        <Button
          size="sm"
          variant="outline"
          aria-label={`Duplicate ${row.name}`}
          disabled={busy}
          onclick={() => swallow(duplicate)}
        >
          <Copy aria-hidden="true" />Duplicate
        </Button>
      {/if}
      {#if onOpenFile && !readOnly}
        <Button
          size="sm"
          variant="outline"
          onclick={() => onOpenFile?.(entry.path)}
        >
          <FileText aria-hidden="true" />Open file
        </Button>
      {/if}
      {#if row.origin === "project" && definition && entry.trustState === "trusted"}
        <Button size="sm" variant="outline" onclick={() => (reviewOpen = true)}>
          <ShieldCheck aria-hidden="true" />Review trust
        </Button>
      {/if}
      {#if !readOnly && entry.local}
        <Button
          size="sm"
          variant={row.replaces ? "outline" : "destructive"}
          aria-label={row.replaces
            ? `Revert to the ${row.replaces === "builtin" ? "built-in" : "User"} version`
            : `Delete ${row.name}`}
          disabled={busy}
          onclick={() => (deleteOpen = true)}
        >
          {#if row.replaces}
            <RotateCcw aria-hidden="true" />Revert
          {:else}
            <Trash2 aria-hidden="true" />Delete
          {/if}
        </Button>
      {/if}
    </div>
  {/snippet}
</PageHeader>

{#if error}
  <Callout layout="block" tone="destructive" text={error}>
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => swallow(() => store.reloadFiles([row]))}>Reload</Button
      >
    {/snippet}
  </Callout>
{/if}
{#if untrusted}
  {@const declined = entry.trustState === "declined"}
  <Callout
    layout="block"
    tone={declined ? "neutral" : "warning"}
    title={declined ? "You declined this profile" : "Waiting for your review"}
    text={declined
      ? "Nerve doesn't use it until you review and trust it."
      : "This profile comes from this project's files. Nerve uses it only after you trust these exact contents."}
  >
    {#snippet actions()}
      <TrustDecisionActions
        state={entry.trustState}
        {busy}
        onTrust={() => (reviewOpen = true)}
        onDecline={() => swallow(() => decide(false))}
      />
    {/snippet}
  </Callout>
{:else if row.replacedBy}
  <Callout
    layout="block"
    text={`Replaced by the project copy. Changes here have no effect${projectName ? " in this project" : ""}.`}
  >
    {#snippet actions()}
      {#if copy}
        <Button size="sm" variant="outline" onclick={() => onOpen(copy.id)}
          >Open the copy</Button
        >
      {/if}
    {/snippet}
  </Callout>
{:else if readOnly}
  <Callout
    layout="block"
    text="Built-in profiles are read-only. Customize saves a copy with the same ID that replaces this one."
  >
    {#snippet actions()}
      <LevelMenu
        label="Customize"
        {projectName}
        onSelect={(layer) => swallow(() => customize(layer))}
      />
    {/snippet}
  </Callout>
{/if}
{#each entry.diagnostics.filter((d) => d.code !== "needs-review" && d.code !== "declined") as diagnostic, index (index)}
  <Callout
    layout="block"
    tone="warning"
    text={`${diagnostic.code}: ${diagnostic.pointer}`}
  >
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => swallow(() => store.reloadFiles([row]))}>Reload</Button
      >
      {#if !readOnly}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onclick={() => (repairOpen = true)}>Repair…</Button
        >
      {/if}
    {/snippet}
  </Callout>
{/each}
{#each kind === "subagent" ? store.launchModelOverrides(row) : [] as launchOverride (launchOverride.layer)}
  <Callout
    layout="block"
    tone="warning"
    text={`Launches use ${launchOverride.own.model?.modelId ?? "the profile model"}${launchOverride.own.reasoningLevel ? ` · ${launchOverride.own.reasoningLevel}` : ""} from an earlier launch setting${launchOverride.layer === "project" ? ` in this project` : ""}, which outranks this profile's model.`}
  >
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        disabled={launchOverride.editor.saving}
        onclick={() =>
          swallow(() => store.clearLaunchModel(row, launchOverride.editor))}
        >Use profile model</Button
      >
    {/snippet}
  </Callout>
{/each}

{#if definition}
  {#if kind === "subagent" && definition.usableBy !== "lead"}
    <LayerEnabledTable
      name={`${definition.label ?? row.name} launches`}
      description="The main agent can launch it."
      {projectName}
      user={launch.user}
      project={launch.project}
      projectSet={launch.projectSet}
      projectOnly={row.origin === "project"}
      pending={untrusted}
      locked={store.launchLocked}
      onChange={(layer, next) =>
        swallow(() => store.setLaunch(row, layer, next))}
    />
  {/if}
  <SettingsSection title="Profile" divided>
    <FieldRow label="Label">
      {#snippet control()}
        <Input
          class="w-full"
          aria-label="Label"
          bind:value={label}
          disabled={readOnly || busy}
          onblur={() =>
            label.trim() !== (definition.label ?? "") && saveHead({ label })}
          onkeydown={(event) =>
            event.key === "Enter" && event.currentTarget.blur()}
        />
      {/snippet}
    </FieldRow>
    <FieldRow
      label="ID"
      description="Agents use this ID to refer to the profile. Duplicate to use a different ID."
    >
      {#snippet control()}
        <span class="truncate font-mono text-ui text-muted-foreground"
          >{row.name}</span
        >
      {/snippet}
    </FieldRow>
    <FieldRow
      label="When to use"
      description="The agent reads this to decide when to use the profile."
      layout="stacked"
    >
      <Textarea
        rows={2}
        aria-label="When to use"
        bind:value={whenToUse}
        disabled={readOnly || busy}
        placeholder="Use when…"
        onblur={() =>
          whenToUse.trim() &&
          whenToUse.trim() !== definition.whenToUse &&
          saveHead({ whenToUse })}
      />
    </FieldRow>
    <FieldRow label="Used as">
      {#snippet control()}
        <SelectField
          class="w-full"
          ariaLabel="Used as"
          disabled={readOnly || busy}
          items={[
            { value: "lead", label: "Main agent" },
            { value: "subagent", label: "Sub-agent" },
            { value: "both", label: "Both" },
          ]}
          value={definition.usableBy}
          onValueChange={(value) =>
            value !== definition.usableBy &&
            saveHead({ usableBy: value as ProfileUsableBy })}
        />
      {/snippet}
    </FieldRow>
  </SettingsSection>

  <SettingsSection
    title="Changes"
    description="Starts from your settings; change only what this profile needs."
    info="Recommended changes apply when the profile starts and can be changed in the conversation. Required ones are locked."
    surface={false}
  >
    {#snippet actions()}
      {#if sections.length && !readOnly}{@render addMenu(false)}{/if}
    {/snippet}
    {#if sections.length === 0}
      <PageEmptyState
        variant="card"
        title="Uses your defaults"
        description={readOnly
          ? "Customize this profile to add changes."
          : "Add a change to override one setting for this profile."}
        actions={readOnly ? undefined : emptyActions}
      />
    {:else}
      {#each sections as section (section.label)}
        <div class="grid gap-1.5">
          <GroupLabel label={section.label} class="pl-1" />
          <PageList ariaLabel={section.label}>
            {#each section.rows as change (change.key)}
              {@const title = changeRowLabel(change)}
              <PageItem
                {title}
                summary={changeValueText(change, textDeps) || "Not written yet"}
                onOpen={readOnly
                  ? undefined
                  : () => openEditor(asDraft(change), title)}
                openLabel={`Edit ${title}`}
              >
                {#snippet badges()}
                  {#if change.key !== "instructions"}
                    {#if change.mode === "require"}
                      <TipBadge
                        variant="info"
                        text="Required"
                        tip="Locked: conversations using this profile can't change it."
                      />
                    {:else}
                      <TipBadge
                        variant="success"
                        text="Recommended"
                        tip="Applied when the profile starts; the conversation can still change it."
                      />
                    {/if}
                  {/if}
                {/snippet}
                {#snippet actions()}
                  {#if !readOnly}
                    {#if change.key !== "instructions"}
                      <IconAction
                        icon={change.mode === "require" ? Lock : LockOpen}
                        label={modeHint(
                          change.mode === "require" ? "require" : "recommend",
                        )}
                        disabled={busy}
                        onclick={() =>
                          swallow(() =>
                            persist(
                              unifyChangeMode(
                                asDraft(change),
                                change.mode === "require"
                                  ? "recommend"
                                  : "require",
                              ),
                            ),
                          )}
                      />
                    {/if}
                    <IconAction
                      icon={Trash2}
                      label={`Remove ${title} change`}
                      disabled={busy}
                      onclick={() =>
                        swallow(() =>
                          persist(unifyChangeMode(asDraft(change), "settings")),
                        )}
                    />
                  {/if}
                {/snippet}
              </PageItem>
            {/each}
          </PageList>
        </div>
      {/each}
    {/if}
  </SettingsSection>
{:else}
  <PageEmptyState
    variant="card"
    title="This profile can't be read"
    description="Repair the file or reload it from disk."
  />
{/if}

{#snippet emptyActions()}{@render addMenu(true)}{/snippet}

<ProfileChangeDialog
  bind:open={editorOpen}
  change={editing?.change}
  title={editing?.title ?? ""}
  {context}
  usableBy={definition?.usableBy ?? kind}
  onSave={persist}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  {...row.replaces
    ? {
        title: `Revert to the ${row.replaces === "builtin" ? "built-in" : "User"} version?`,
        description: `All changes to this copy are discarded and the ${row.replaces === "builtin" ? "built-in" : "User"} version applies again. Existing conversations are unchanged.`,
        confirmLabel: "Revert",
      }
    : {
        title: "Delete profile?",
        description:
          "The profile is removed from these settings. Existing conversations are unchanged.",
        confirmLabel: "Delete profile",
      }}
  onConfirm={remove}
/>
<ProfileTrustReviewDialog
  bind:open={reviewOpen}
  profile={entry}
  lines={rows.map((change) => ({
    label: change.label,
    value: changeValueText(change, textDeps),
  }))}
  {busy}
  {error}
  onDecide={(trusted) => swallow(() => decide(trusted))}
/>
{#if repairOpen}
  <ConfigurationRepairDialog
    bind:open={repairOpen}
    target={{
      document: "profile",
      scope: store.scopeOf(row.origin) ?? { scope: "user" },
      name: row.name,
    }}
    replacement={repairReplacement}
    onRepaired={() => store.reload()}
  />
{/if}
