<!--
  The page header of an open extension, in the settings page-header slot:
  `Extensions › [mark] Name`, its description and the enable switch. It
  stays valid while the extension view loads or when the id is unknown, so the
  heading never jumps.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { SettingsPageHeader } from "$lib/presentation/settings";
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
};

let {
  parentLabel,
  itemId,
  extension,
  busy = false,
  onBack,
  onEnabledChange,
}: Props = $props();

const source = $derived(extension?.enabled.source);
</script>

<SettingsPageHeader
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
      <Switch
        checked={extension.enabled.value}
        disabled={busy || extension.readOnly || source?.locked === true}
        aria-label={`Enable ${extension.metadata.name}`}
        onCheckedChange={onEnabledChange}
      />
    {/if}
  {/snippet}
</SettingsPageHeader>
