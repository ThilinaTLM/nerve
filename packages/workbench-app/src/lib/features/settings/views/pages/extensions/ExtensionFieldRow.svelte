<!--
  One setting of an extension, generated from its schema field: the control
  follows the field type; fixed values show their value and who fixed them.
  With a project open the row is a LayerRow: the label and description on the
  full width, then the User and project controls in two halves.
-->
<script lang="ts" module>
import { FieldRow } from "@nervekit/ui-kit/components/composites/page";
import type { FieldItem } from "./extensions-view";

/** The User layer of a row shown in two cells; `item` is then the project's. */
export type FieldLayers = {
  projectName: string;
  /** Absent when the field cannot be set at User level. */
  userItem?: FieldItem;
  /** The project's own value differs from User's. */
  projectReset?: { label: string; onReset: () => void };
  userReset?: { label: string; onReset: () => void };
  onUserChange: (value: unknown) => void;
  /** The project's settings file is not trusted. */
  locked?: boolean;
  /** The extension is defined by the project: no User layer. */
  projectOnly?: boolean;
};
</script>

<script lang="ts">
import type { ExtensionsView } from "@nervekit/contracts/extensions";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ModelInfo } from "$lib/api";
import { LayerRow, SettingsChangeIndicator } from "$lib/presentation/settings";
import ExtensionFieldControl from "./ExtensionFieldControl.svelte";
import {
  controlFor,
  type AccountChoices,
  type ExtensionChange,
  type ExtensionsScope,
} from "./extensions-view";

type Props = {
  extensionId: string;
  /** Project whose profiles and rule sets `agentProfile` and `permissionRuleSet` fields offer. */
  projectId?: string;
  item: FieldItem;
  scope: ExtensionsScope;
  accounts: AccountChoices;
  /** Labels of the extension's account kinds, by kind. */
  kindLabels?: Readonly<Record<string, string>>;
  /** Authenticated models for `model` fields. */
  models?: ModelInfo[];
  /** The host's image generation models for `imageModel` fields. */
  imageModels?: ExtensionsView["imageModels"];
  /** Differs from the inherited value. */
  change?: ExtensionChange;
  disabled?: boolean;
  /** Two cells (User, project) instead of one control. */
  layers?: FieldLayers;
  /**
   * A namespace row of Features that carries this field as its switch: the
   * namespace names the row, and `problem` is why it cannot be used.
   */
  feature?: { id: string; summary: string; problem?: string };
  /** `undefined` clears the value at this scope (the project's with `layers`). */
  onChange: (value: unknown) => void;
  onReset: () => void;
};

let {
  extensionId,
  projectId,
  item,
  scope,
  accounts,
  kindLabels,
  models = [],
  imageModels = [],
  change,
  disabled = false,
  layers,
  feature,
  onChange,
  onReset,
}: Props = $props();

const field = $derived(item.field);
const kind = $derived(controlFor(field));
const locked = $derived(!item.editable);
const inputId = $derived(`extension-${extensionId}-${item.key}`);
const labelFor = $derived(
  locked || kind === "switch" || kind === "model" ? undefined : inputId,
);
</script>

{#snippet problemHint()}
  <span class="inline-flex items-center gap-1 text-warning">
    <TriangleAlert class="size-3 flex-none" aria-hidden="true" />
    {feature?.problem}
  </span>
{/snippet}

{#if layers}
  <LayerRow
    label={feature?.id ?? field.label}
    description={feature?.summary ?? field.description}
    hint={feature?.problem ? problemHint : undefined}
    projectName={layers.projectName}
    userAbsent={layers.projectOnly || !layers.userItem}
    projectNote={item.editable
      ? undefined
      : (item.readOnlyReason ?? "Not set here")}
    userReset={layers.userReset}
    projectReset={layers.projectReset}
  >
    {#snippet user()}
      {#if layers.userItem}
        <ExtensionFieldControl
          {extensionId}
          {projectId}
          item={layers.userItem}
          idSuffix="-user"
          {accounts}
          {kindLabels}
          {models}
          {imageModels}
          {disabled}
          onChange={layers.onUserChange}
        />
      {/if}
    {/snippet}
    {#snippet project()}
      <ExtensionFieldControl
        {extensionId}
        {projectId}
        {item}
        idSuffix="-project"
        {accounts}
        {kindLabels}
        {models}
        {imageModels}
        disabled={disabled || layers.locked === true}
        {onChange}
      />
    {/snippet}
  </LayerRow>
{:else}
  <FieldRow
    hint={feature?.problem ? problemHint : undefined}
    label={feature?.id ?? field.label}
    description={feature?.summary ?? field.description}
    mono={feature !== undefined}
    htmlFor={labelFor}
  >
    {#snippet badges()}
      {#if change}
        <SettingsChangeIndicator {scope} from={change.from} {onReset} />
      {/if}
    {/snippet}
    {#snippet control()}
      <ExtensionFieldControl
        {extensionId}
        {projectId}
        {item}
        {accounts}
        {kindLabels}
        {models}
        {imageModels}
        {disabled}
        {onChange}
      />
    {/snippet}
  </FieldRow>
{/if}
