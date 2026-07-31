<script lang="ts">
import {
  StatusDot,
  type StatusTone,
} from "@nervekit/ui-kit/components/ui/status-dot";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type Props = {
  status?: string;
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

const tone = $derived(tones[(status as SaveStatus) ?? "idle"] ?? "neutral");
</script>

<div
  class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t border-border/70 px-1.5 pt-3"
>
  <StatusDot {tone} class="mt-1" />
  <p class="text-xs text-muted-foreground">{text}</p>
</div>
