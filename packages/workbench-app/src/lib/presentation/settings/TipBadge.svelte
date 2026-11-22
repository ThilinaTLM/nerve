<!-- A badge that explains itself on hover. -->
<script lang="ts">
import { Badge, type BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";
import HoverTip from "./HoverTip.svelte";

let {
  text,
  tip,
  variant = "neutral",
}: { text: string; tip: string; variant?: BadgeVariant } = $props();
</script>

<HoverTip {tip}><Badge {variant}>{text}</Badge></HoverTip>
