<script lang="ts">
import {
  StatusDot,
  type StatusTone,
} from "@nervekit/ui-kit/components/composites/status-dot";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type Props = {
  status?: SaveStatus;
  text: string;
};

let { status = "idle", text }: Props = $props();

const tones: Record<SaveStatus, StatusTone> = {
  idle: "neutral",
  dirty: "running",
  saving: "running",
  saved: "good",
  error: "danger",
};

const tone = $derived(tones[status ?? "idle"] ?? "neutral");
</script>

<!-- `settings-sidebar-status` is the placement hook the settings shell uses to
     move this row into the title row in its compact container layout. -->
<div
  class="settings-sidebar-status grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t border-t-border/70 px-1.5 pt-3 pb-0"
>
  <StatusDot {tone} class="mt-1" />
  <p class="text-xs text-muted-foreground">{text}</p>
</div>
