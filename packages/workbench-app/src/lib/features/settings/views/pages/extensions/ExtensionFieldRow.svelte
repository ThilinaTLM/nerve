<!--
  One setting of an extension, generated from its schema field: the control
  follows the field type; fixed values show their value and who fixed them.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { ModelInfo } from "$lib/api";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import {
  SettingsChangeIndicator,
  SettingsRow,
} from "$lib/presentation/settings";
import {
  controlFor,
  displayValue,
  parseNumberInput,
  type AccountChoices,
  type ExtensionChange,
  type ExtensionsScope,
  type FieldItem,
} from "./extensions-view";

type Props = {
  extensionId: string;
  item: FieldItem;
  scope: ExtensionsScope;
  accounts: AccountChoices;
  /** Authenticated models for `model` fields. */
  models?: ModelInfo[];
  /** Differs from the inherited value. */
  change?: ExtensionChange;
  disabled?: boolean;
  /** `undefined` clears the value at this scope. */
  onChange: (value: unknown) => void;
  onReset: () => void;
  onAddAccount: () => void;
};

let {
  extensionId,
  item,
  scope,
  accounts,
  models = [],
  change,
  disabled = false,
  onChange,
  onReset,
  onAddAccount,
}: Props = $props();

const field = $derived(item.field);
const kind = $derived(controlFor(field));
const inputId = $derived(`extension-${extensionId}-${item.key}`);
const locked = $derived(!item.editable);
const accountItems = $derived(
  field.type === "account"
    ? (accounts[field.kind] ?? []).map((account) => ({
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
    ? (item.value as { provider: string; modelId: string } | undefined)
    : undefined,
);

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

<SettingsRow
  label={field.label}
  description={field.description}
  htmlFor={locked || kind === "switch" || kind === "model"
    ? undefined
    : inputId}
>
  {#snippet badges()}
    {#if change}
      <SettingsChangeIndicator
        {scope}
        from={change.from}
        to={change.to}
        {onReset}
      />
    {/if}
  {/snippet}
  {#snippet control()}
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
      <div class="grid w-full min-w-0 gap-1">
        <div class="min-w-0">
          <SelectField
            items={accountItems}
            value={typeof item.value === "string" ? item.value : ""}
            placeholder={accountItems.length > 0
              ? "Choose account"
              : "No accounts"}
            {disabled}
            ariaLabel={field.label}
            onValueChange={(next) => onChange(next)}
          />
        </div>
        <!-- Accounts live in user settings; a project cannot add one. -->
        {#if scope === "user"}
          <div class="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              class="text-muted-foreground"
              onclick={onAddAccount}>Add account</Button
            >
          </div>
        {/if}
      </div>
    {:else if field.type === "model"}
      <ModelPicker
        label={field.label}
        class="w-full"
        {models}
        {disabled}
        showReasoning={false}
        requiredCapabilities={field.capability === "vision" ? ["vision"] : []}
        value={modelValue}
        thinkingLevel={undefined}
        emptyMessage="Connect a provider with a suitable model first."
        onChange={(next) => onChange(next.model)}
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
          <span class="flex-none text-ui text-muted-foreground"
            >{field.unit}</span
          >
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
  {/snippet}
</SettingsRow>
