<script lang="ts">
import type { Settings } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { SettingsChange } from "../settings-change";

type Props = {
  open?: boolean;
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

let {
  open = $bindable(false),
  settingsDraft,
  onSettingsChange,
}: Props = $props();

let enabledDraft = $state(true);
let secondsDraft = $state("120");
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    const autoPromotion = settingsDraft.tools.bash.autoPromotion;
    enabledDraft = autoPromotion.enabled;
    secondsDraft = String(autoPromotion.afterMs / 1000);
  }
  lastOpen = open;
});

const validSeconds = $derived(
  Number.isInteger(Number(secondsDraft)) &&
    Number(secondsDraft) >= 1 &&
    Number(secondsDraft) <= 86_400,
);

function save(): void {
  if (!validSeconds) return;
  const afterMs = Number(secondsDraft) * 1000;
  settingsDraft.tools.bash.autoPromotion.enabled = enabledDraft;
  settingsDraft.tools.bash.autoPromotion.afterMs = afterMs;
  onSettingsChange?.(
    {
      tools: {
        bash: {
          autoPromotion: { enabled: enabledDraft, afterMs },
        },
      },
    },
    { immediate: true },
  );
  open = false;
}
</script>

<Dialog
  bind:open
  size="sm"
  title="Configure Shell"
  description="Choose whether long-running Bash calls should continue in the background."
>
  <div class="grid gap-4">
    <div class="flex items-center justify-between gap-4">
      <div class="grid gap-1">
        <Label for="tools-bash-auto-promotion-enabled"
          >Automatic backgrounding</Label
        >
        <p class="text-xs text-muted-foreground">
          Promote Bash calls that are still running after the configured delay.
        </p>
      </div>
      <Switch
        id="tools-bash-auto-promotion-enabled"
        size="settings"
        checked={enabledDraft}
        aria-label="Enable automatic backgrounding"
        onCheckedChange={(checked) => (enabledDraft = checked)}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="tools-bash-auto-promotion-seconds">Background after</Label>
      <div class="flex items-center gap-2">
        <Input
          size="xs"
          id="tools-bash-auto-promotion-seconds"
          type="number"
          min={1}
          max={86_400}
          step={1}
          bind:value={secondsDraft}
          disabled={!enabledDraft}
          aria-label="Background after seconds"
        />
        <span class="text-xs text-muted-foreground">seconds</span>
      </div>
      {#if !validSeconds}
        <p class="text-xs text-destructive">
          Enter a whole number from 1 to 86,400.
        </p>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button size="sm" onclick={save} disabled={!validSeconds}>Save</Button>
  {/snippet}
</Dialog>
