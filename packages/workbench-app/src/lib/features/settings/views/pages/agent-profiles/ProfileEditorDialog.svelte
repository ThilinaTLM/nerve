<script lang="ts">
import { skillOverrideKind } from "$lib/domain/skills/skill-catalog";
import { untrack } from "svelte";
import type {
  ProfileDefinition,
  ProfileCatalogEntry,
} from "@nervekit/contracts/agent-configuration";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { SettingsSection, SettingsRow } from "$lib/presentation/settings";
import ProfileChangeForm from "./ProfileChangeForm.svelte";
import {
  changeRows,
  applyProfileChange,
  nameFromLabel,
  type ChangeKey,
} from "./profile-changes";
import type { ProfileEditContext, ChangeDraft } from "./profile-edit-context";
import { toolRows } from "../tools/tool-settings";
let {
  open = $bindable(false),
  definition,
  isNew = false,
  profiles,
  context,
  onSave,
}: {
  open?: boolean;
  definition: ProfileDefinition;
  isNew?: boolean;
  profiles: ProfileCatalogEntry[];
  context: ProfileEditContext;
  onSave: (definition: ProfileDefinition) => Promise<void>;
} = $props();
let draft = $state(untrack(() => structuredClone($state.snapshot(definition))));
let error = $state<string>();
let saving = $state(false);
let start = $state("blank");
const keys = $derived<ChangeKey[]>([
  "model",
  "permission",
  "compaction",
  ...toolRows
    .filter(
      (t) =>
        draft.usableBy !== "subagent" ||
        (t.id !== "plan_present" && t.id !== "subagents"),
    )
    .map((t) => `tool:${t.id}` as ChangeKey),
  "skill-defaults",
  ...context.skills.map(
    (skill) =>
      `skill:${skillOverrideKind(skill.source)}:${skill.name}` as ChangeKey,
  ),
  ...changeRows(draft)
    .filter((row) => row.key.startsWith("skill:"))
    .map((row) => row.key)
    .filter(
      (key) =>
        !context.skills.some(
          (skill) =>
            key === `skill:${skillOverrideKind(skill.source)}:${skill.name}`,
        ),
    ),
  "instructions",
]);
let changes = $state<Record<string, ChangeDraft>>({});
let originalChanges: Record<string, ChangeDraft> = {};
function resetChanges(value: ProfileDefinition) {
  const rows = changeRows(value);
  const next: Record<string, ChangeDraft> = {};
  for (const key of [
    "model",
    "permission",
    "compaction",
    ...toolRows.map((t) => `tool:${t.id}`),
    "skill-defaults",
    ...context.skills.map(
      (skill) =>
        `skill:${skillOverrideKind(skill.source)}:${skill.name}` as ChangeKey,
    ),
    ...rows.filter((row) => row.key.startsWith("skill:")).map((row) => row.key),
    "instructions",
  ] as ChangeKey[]) {
    const row = rows.find((r) => r.key === key);
    const skillValue = {
      ...value.recommendations?.skills,
      ...value.requirements?.skills,
    };
    next[key] = {
      key,
      mode: row?.mode ?? (key === "instructions" ? "recommend" : "settings"),
      value:
        row?.value ??
        (key === "instructions"
          ? value.instructions
          : key === "skill-defaults"
            ? skillValue
            : key.startsWith("tool:")
              ? context.seedTool(
                  key.slice(5) as Parameters<typeof context.seedTool>[0],
                )
              : undefined),
    };
  }
  return next;
}
$effect(() => {
  const value = definition;
  untrack(() => {
    draft = structuredClone($state.snapshot(value));
    changes = resetChanges(value);
    originalChanges = structuredClone($state.snapshot(changes));
  });
});
function copy(name: string) {
  start = name;
  const source = profiles.find((p) => p.name === name)?.definition;
  const value = source
    ? structuredClone($state.snapshot(source))
    : {
        schemaVersion: 1 as const,
        name: "new-profile",
        description: "",
        instructions: "",
        usableBy: draft.usableBy,
      };
  draft = {
    ...value,
    name: draft.name,
    label: draft.label,
    description: draft.description,
    usableBy: draft.usableBy,
  };
  changes = resetChanges(value);
  originalChanges = structuredClone($state.snapshot(changes));
}
async function save() {
  saving = true;
  error = undefined;
  try {
    let next = {
      ...$state.snapshot(draft),
      name: isNew ? nameFromLabel(draft.label ?? "") : draft.name,
    };
    for (const key of keys) {
      if (JSON.stringify(changes[key]) !== JSON.stringify(originalChanges[key]))
        next = applyProfileChange(next, $state.snapshot(changes[key]!));
    }
    await onSave(next);
    open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
</script>
<DialogShell
  bind:open
  size="wide"
  title={isNew ? "New profile" : `Edit ${draft.label ?? draft.name}`}
  description="Default follows your settings. Changes apply to future uses of this profile."
>
  <div class="grid gap-5">
    {#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
    <SettingsSection divided>
      <SettingsRow label="Name"
        >{#snippet control()}<Input
            aria-label="Profile name"
            bind:value={draft.label}
          />{/snippet}</SettingsRow
      >
      <SettingsRow label="Description"
        >{#snippet control()}<Input
            aria-label="Profile description"
            bind:value={draft.description}
          />{/snippet}</SettingsRow
      >
      {#if isNew}
        <SettingsRow label="Used by"
          >{#snippet control()}<ToggleGroup.Root
              type="single"
              variant="outline"
              size="sm"
              bind:value={draft.usableBy}
              aria-label="Used by"
              ><ToggleGroup.Item value="lead">Agents</ToggleGroup.Item
              ><ToggleGroup.Item value="subagent">Sub-agents</ToggleGroup.Item
              ><ToggleGroup.Item value="both">Both</ToggleGroup.Item
              ></ToggleGroup.Root
            >{/snippet}</SettingsRow
        >
        <SettingsRow label="Start from"
          >{#snippet control()}<SelectField
              ariaLabel="Start from"
              value={start}
              onValueChange={copy}
              items={[
                { value: "blank", label: "Defaults only" },
                ...profiles
                  .filter((p) => p.definition)
                  .map((p) => ({
                    value: p.name,
                    label: p.definition?.label ?? p.name,
                  })),
              ]}
            />{/snippet}</SettingsRow
        >
      {/if}
    </SettingsSection>
    {#each [{ title: "Model and behavior", keys: keys.filter( (k) => ["model", "permission", "compaction"].includes(k) ) }, { title: "Tools", keys: keys.filter( (k) => k.startsWith("tool:") ) }, { title: "Skills", keys: keys.filter( (key) => key.startsWith("skill") ) }, { title: "Instructions", keys: ["instructions"] as ChangeKey[] }] as section (section.title)}
      <SettingsSection title={section.title} divided>
        {#each section.keys as key (key)}
          <SettingsRow
            layout="stacked"
            label={key.startsWith("skill:")
              ? key.split(":").slice(2).join(":")
              : key.startsWith("tool:")
                ? (toolRows.find((t) => `tool:${t.id}` === key)?.label ?? key)
                : ((
                    {
                      model: "Model and reasoning",
                      permission: "Permissions",
                      compaction: "Compaction",
                      "skill-defaults": "Skill source defaults",
                      instructions: "Instructions",
                    } as Record<string, string>
                  )[key] ?? key)}
          >
            {#snippet control()}{#if changes[key]}<ProfileChangeForm
                  compact
                  bind:draft={changes[key]}
                  usableBy={draft.usableBy}
                  {context}
                  fixedTool={key.startsWith("tool:")}
                />{/if}{/snippet}
          </SettingsRow>
        {/each}
      </SettingsSection>
    {/each}
  </div>
  {#snippet footer()}<Button
      variant="ghost"
      disabled={saving}
      onclick={() => (open = false)}>Cancel</Button
    ><Button
      disabled={saving ||
        !draft.label?.trim() ||
        !draft.description.trim() ||
        (isNew &&
          profiles.some((p) => p.name === nameFromLabel(draft.label ?? "")))}
      onclick={save}>{isNew ? "Create profile" : "Save"}</Button
    >{/snippet}
</DialogShell>
