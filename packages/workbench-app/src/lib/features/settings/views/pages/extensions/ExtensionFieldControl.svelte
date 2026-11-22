<!--
  The control of one extension setting, generated from its schema field: it
  follows the field type; fixed values show their value and who fixed them.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { ModelInfo } from "$lib/api";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { selectablePermissionRuleSets } from "$lib/domain/permissions/rule-set-options";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import { leadAgentProfiles } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import {
  controlFor,
  displayValue,
  parseNumberInput,
  accountChoicesFor,
  type AccountChoices,
  type FieldItem,
} from "./extensions-view";

type Props = {
  extensionId: string;
  /** Project whose profiles and rule sets `agentProfile` and `permissionRuleSet` fields offer. */
  projectId?: string;
  item: FieldItem;
  /** Keeps ids apart when the same field has a control per layer. */
  idSuffix?: string;
  accounts: AccountChoices;
  /** Labels of the extension's account kinds, by kind. */
  kindLabels?: Readonly<Record<string, string>>;
  /** Authenticated models for `model` fields. */
  models?: ModelInfo[];
  disabled?: boolean;
  /** `undefined` clears the value at this layer. */
  onChange: (value: unknown) => void;
};

let {
  extensionId,
  projectId,
  item,
  idSuffix = "",
  accounts,
  kindLabels,
  models = [],
  disabled = false,
  onChange,
}: Props = $props();

const field = $derived(item.field);
const kind = $derived(controlFor(field));
const inputId = $derived(`extension-${extensionId}-${item.key}${idSuffix}`);
const locked = $derived(!item.editable);
const accountItems = $derived(
  field.type === "account"
    ? accountChoicesFor(field, accounts, kindLabels).map((account) => ({
        value: account.id,
        label: account.name,
        ...(account.detail ? { detail: account.detail } : {}),
      }))
    : [],
);
const shown = $derived(
  displayValue(field, item.value, accounts, (selection) => {
    const value = selection as { provider: string; modelId: string };
    return models.find(
      (model) =>
        model.provider === value.provider && model.modelId === value.modelId,
    )?.name;
  }),
);
const modelValue = $derived(
  field.type === "model"
    ? (item.value as
        | {
            provider: string;
            modelId: string;
            reasoningLevel?: ThinkingLevel;
          }
        | undefined)
    : undefined,
);

/** The explicit "unset" choice of the profile and rule set selects. */
const UNSET = "";
$effect(() => {
  if (field.type === "agentProfile") void agentProfileCatalog.ensure(projectId);
  if (field.type === "permissionRuleSet" && projectId)
    void permissionRuleSetCatalog.ensure(projectId);
});
const profileItems = $derived(
  field.type === "agentProfile"
    ? [
        {
          value: UNSET,
          label: "Default",
          detail: "The project's default profile",
        },
        ...leadAgentProfiles(agentProfileCatalog.profiles(projectId)).map(
          (profile) => ({
            value: profile.name,
            label: profile.label,
            ...(profile.whenToUse ? { detail: profile.whenToUse } : {}),
          }),
        ),
      ]
    : [],
);
const ruleSetItems = $derived(
  field.type === "permissionRuleSet"
    ? [
        { value: UNSET, label: "Default", detail: "Your default rule set" },
        ...selectablePermissionRuleSets(
          permissionRuleSetCatalog.summaries(projectId),
        ).map((summary) => ({
          value: summary.id,
          label: summary.name,
          ...(summary.description ? { detail: summary.description } : {}),
        })),
      ]
    : [],
);

/** A model pick keeps the reasoning level only once the user chose one. */
function changeModel(next: {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
}): void {
  if (!next.model) return;
  onChange(
    field.type === "model" && field.reasoning && modelValue?.reasoningLevel
      ? { ...next.model, reasoningLevel: next.thinkingLevel }
      : next.model,
  );
}

let text = $derived(item.value === undefined ? "" : String(item.value));
let invalid = $state(false);

function commit(): void {
  if (kind === "number") {
    const parsed = parseNumberInput(text);
    invalid = parsed === "invalid";
    if (parsed === "invalid" || parsed === item.value) return;
    onChange(parsed);
    return;
  }
  const next = text.trim() === "" ? undefined : text.trim();
  if (next === item.value) return;
  onChange(next);
}
</script>

{#if locked}
  <span
    class="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground"
    title={item.readOnlyReason}
  >
    <span class="truncate">{shown ?? "Not set"}</span>
    <Lock
      class="size-3.5 flex-none"
      aria-label={item.readOnlyReason ?? "Read-only"}
    />
  </span>
{:else if field.type === "boolean"}
  <Switch
    checked={item.value === true}
    {disabled}
    aria-label={field.label}
    onCheckedChange={(next) => onChange(next)}
  />
{:else if field.type === "enum"}
  <SelectField
    items={field.options.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.description ? { detail: option.description } : {}),
    }))}
    value={String(item.value ?? field.default)}
    {disabled}
    ariaLabel={field.label}
    onValueChange={(next) => onChange(next)}
  />
{:else if field.type === "account"}
  <SelectField
    items={accountItems}
    value={typeof item.value === "string" ? item.value : ""}
    placeholder={accountItems.length > 0 ? "Choose account" : "No accounts yet"}
    disabled={disabled || accountItems.length === 0}
    ariaLabel={field.label}
    onValueChange={(next) => onChange(next)}
  />
{:else if field.type === "model"}
  <ModelPicker
    label={field.label}
    class="w-full"
    {models}
    {disabled}
    showReasoning={field.reasoning === true}
    requiredCapabilities={field.capability === "vision" ? ["vision"] : []}
    value={modelValue}
    thinkingLevel={modelValue?.reasoningLevel}
    unsetReasoningLabel="Default"
    onThinkingChange={field.reasoning && modelValue
      ? (level) =>
          onChange({
            provider: modelValue.provider,
            modelId: modelValue.modelId,
            ...(level ? { reasoningLevel: level } : {}),
          })
      : undefined}
    emptyMessage="Connect a provider with a suitable model first."
    onChange={(next) =>
      field.reasoning && next.model ? changeModel(next) : onChange(next.model)}
  />
{:else if field.type === "agentProfile"}
  <SelectField
    items={profileItems}
    value={typeof item.value === "string" ? item.value : UNSET}
    {disabled}
    ariaLabel={field.label}
    onValueChange={(next) => onChange(next === UNSET ? undefined : next)}
  />
{:else if field.type === "permissionRuleSet"}
  <SelectField
    items={ruleSetItems}
    value={typeof item.value === "string" ? item.value : UNSET}
    {disabled}
    ariaLabel={field.label}
    onValueChange={(next) => onChange(next === UNSET ? undefined : next)}
  />
{:else if field.type === "number"}
  <div class="flex w-full items-center gap-2">
    <Input
      id={inputId}
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      {disabled}
      aria-invalid={invalid ? "true" : undefined}
      bind:value={text}
      onblur={commit}
      onkeydown={(event) => event.key === "Enter" && commit()}
    />
    {#if field.unit}
      <span class="flex-none text-ui text-muted-foreground">{field.unit}</span>
    {/if}
  </div>
{:else}
  <Input
    id={inputId}
    type={field.format === "url" ? "url" : "text"}
    placeholder={field.placeholder ?? field.default}
    maxlength={field.maxLength}
    {disabled}
    bind:value={text}
    onblur={commit}
    onkeydown={(event) => event.key === "Enter" && commit()}
  />
{/if}
