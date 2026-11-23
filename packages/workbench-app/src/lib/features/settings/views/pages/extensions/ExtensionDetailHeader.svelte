<!--
  The page header of an open extension, in the settings page-header slot:
  `Extensions › [mark] Name`, its description and, with no project open, the
  enable switch. With one, the User and project switches are an "Enabled" table
  row under the header (`below`), never in the title row. It
  stays valid while the extension view loads or when the id is unknown, so the
  heading never jumps.
-->
<script lang="ts">
import { PageHeader } from "@nervekit/ui-kit/components/composites/page";
import Lock from "@lucide/svelte/icons/lock";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  LayerEnabledTable,
  type SettingsLayer,
} from "$lib/presentation/settings";
import ExtensionMark from "./ExtensionMark.svelte";

type Props = {
  /** The page this detail belongs to ("Extensions"); its label goes back. */
  parentLabel: string;
  itemId: string;
  /** Absent while loading or when the id is unknown. */
  extension?: ExtensionView;
  /** Saving, or the view is not loaded. */
  busy?: boolean;
  onBack: () => void;
  onEnabledChange: (enabled: boolean) => void;
  /** With a project open: the User and project switches replace the single one. */
  layers?: {
    projectName: string;
    user: boolean;
    project: boolean;
    projectSet: boolean;
    projectOnly: boolean;
    locked: boolean;
    onChange: (layer: SettingsLayer, value: boolean) => void;
  };
};

let {
  parentLabel,
  itemId,
  extension,
  busy = false,
  onBack,
  onEnabledChange,
  layers,
}: Props = $props();

const source = $derived(extension?.enabled.source);
</script>

<PageHeader
  title={extension?.metadata.name ?? itemId}
  description={extension?.metadata.description}
  parent={{ label: parentLabel, onBack }}
  class="mb-1"
>
  {#snippet leading()}
    {#if extension}
      <ExtensionMark
        icon={extension.metadata.icon}
        size="inline"
        off={!extension.enabled.value}
      />
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if extension}
      {#if source?.locked}
        <span
          class="inline-flex"
          title={`Locked by ${source.profile ?? "profile"}`}
        >
          <Lock
            class="size-3.5 text-muted-foreground"
            aria-label={`Locked by ${source.profile ?? "profile"}`}
          />
        </span>
      {/if}
      {#if !layers}
        <Switch
          checked={extension.enabled.value}
          disabled={busy || extension.readOnly || source?.locked === true}
          aria-label={`Enable ${extension.metadata.name}`}
          onCheckedChange={onEnabledChange}
        />
      {/if}
    {/if}
  {/snippet}
  {#snippet below()}
    {#if extension && layers}
      <div class="pt-2">
        <LayerEnabledTable
          name={extension.metadata.name}
          description="On for every project, or only here."
          projectName={layers.projectName}
          user={layers.user}
          project={layers.project}
          projectSet={layers.projectSet}
          projectOnly={layers.projectOnly}
          locked={layers.locked}
          onChange={layers.onChange}
        />
      </div>
    {/if}
  {/snippet}
</PageHeader>
