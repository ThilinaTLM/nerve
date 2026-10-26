<!-- Per-page summary in Project settings: how many settings differ, with one reset. -->
<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SettingsInlineMessage from "./SettingsInlineMessage.svelte";

type Props = {
  count: number;
  /** What the settings differ from, e.g. "your user settings". */
  against?: string;
  onResetAll: () => void;
};
let { count, against = "your user settings", onResetAll }: Props = $props();
</script>

<SettingsInlineMessage
  tone={count > 0 ? "info" : "neutral"}
  text={count > 0
    ? `${count} ${count === 1 ? "setting differs" : "settings differ"} from ${against}`
    : `Everything here follows ${against}.`}
>
  {#snippet actions()}
    {#if count > 0}
      <Button size="sm" variant="outline" onclick={onResetAll}>
        <RotateCcw class="size-3" aria-hidden="true" />
        Reset all
      </Button>
    {/if}
  {/snippet}
</SettingsInlineMessage>
