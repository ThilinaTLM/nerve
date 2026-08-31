<script lang="ts">
import type { Snippet } from "svelte";
import {
  StatusDot,
  type StatusTone,
} from "@nervekit/ui-kit/components/composites/status-dot";
import { cn } from "@nervekit/ui-kit/utils";
import type { SettingsStatus } from "./settings-component-contracts";

type Props = {
  title: string;
  status?: SettingsStatus;
  class?: string;
  meta?: Snippet;
  actions?: Snippet;
};

let { title, status, class: className, meta, actions }: Props = $props();

const statusTones: Record<SettingsStatus, StatusTone> = {
  ok: "good",
  warning: "warn",
  error: "danger",
  muted: "neutral",
};
</script>

<div
  class={cn(
    "flex items-center justify-between gap-2 rounded-sm border border-border/50 bg-accent/20 px-2 py-1.5",
    className,
  )}
>
  <div class="flex min-w-0 items-center gap-2">
    {#if status}
      <StatusDot tone={statusTones[status]} />
    {/if}
    <div class="grid min-w-0 gap-0.5">
      <span class="truncate text-sm text-foreground">{title}</span>
      {#if meta}
        <span class="truncate text-xs text-muted-foreground">
          {@render meta()}
        </span>
      {/if}
    </div>
  </div>
  {#if actions}
    <div class="flex flex-none items-center gap-1.5">
      {@render actions()}
    </div>
  {/if}
</div>
