<!--
  The "Enabled" table of a layered detail page: a one-row card (label and
  description left, User and project switches right) right under the page
  header, with the column labels on a short right-aligned line above it and the
  same cell widths as the lists further down. It has no section heading. Detail
  titles carry at most one simple action; the layer switches live here instead.
-->
<script lang="ts">
import ColumnLabels from "./ColumnLabels.svelte";
import LayerSwitches from "./LayerSwitches.svelte";
import SettingsItem from "./SettingsItem.svelte";
import SettingsList from "./SettingsList.svelte";
import SettingsSection from "./SettingsSection.svelte";
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

<SettingsSection surface={false}>
  {#snippet layerLabels()}
    {#if projectName}
      <ColumnLabels {projectName} {projectOnly} {locked} chevron />
    {/if}
  {/snippet}
  <SettingsList ariaLabel={title}>
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
</SettingsSection>
