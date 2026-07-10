<script lang="ts">
import { Container } from "@lucide/svelte";
import type { RuntimeDriverCapabilities } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";

let {
  backend,
  runtime,
}: {
  backend: string;
  runtime?: RuntimeDriverCapabilities;
} = $props();

const tone = $derived(runtime && !runtime.available ? "warn" : "neutral");
</script>

<Badge {tone} size="xs" class="gap-1">
  <Container class="size-3" />
  {backend}{runtime?.version ? ` ${runtime.version}` : ""}
  {#if runtime && !runtime.available}(unavailable){/if}
</Badge>
