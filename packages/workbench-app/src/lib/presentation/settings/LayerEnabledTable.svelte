<!--
  The "Enabled" table of a layered detail page: a one-row table (label and
  description left, User and project switches right) under the page header,
  with the same column header and cell widths as the lists further down. Detail
  titles carry at most one simple action; the layer switches live here instead.
-->
<script lang="ts">
import LayerSwitches from "./LayerSwitches.svelte";
import SettingsItem from "./SettingsItem.svelte";
import SettingsList from "./SettingsList.svelte";
import type { SettingsLayer } from "./settings-origin";

type Props = {
  /** Row title; "Enabled", or "Available" for what other agents can use. */
  title?: string;
  description?: string;
  /** Item name for the switches' accessible labels. */
  name: string;
  /** Without a project there is only the User column. */
  projectName?: string;
  user: boolean;
  project?: boolean;
  projectSet?: boolean;
  projectOnly?: boolean;
  locked?: boolean;
  /** Waiting for review: no switches until approved. */
  pending?: boolean;
  /** The project layer does not apply here (another item replaces it). */
  inapplicable?: boolean;
  onChange: (layer: SettingsLayer, value: boolean) => void;
};

let {
  title = "Enabled",
  description,
  name,
  projectName,
  user,
  project,
  projectSet = false,
  projectOnly = false,
  locked = false,
  pending = false,
  inapplicable = false,
  onChange,
}: Props = $props();
</script>

<SettingsList
  ariaLabel={title}
  columns={{ chevron: true, projectName, projectOnly }}
>
  <SettingsItem {title} summary={description}>
    {#snippet meta()}
      <LayerSwitches
        {name}
        {user}
        {project}
        {projectSet}
        {projectName}
        {projectOnly}
        {locked}
        {pending}
        {inapplicable}
        {onChange}
      />
    {/snippet}
  </SettingsItem>
</SettingsList>
