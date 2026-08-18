<script lang="ts">
import Settings2 from "@lucide/svelte/icons/settings-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  label: string;
  onclick: () => void;
};

let { label, onclick }: Props = $props();
</script>

<Button size="xs" variant="outline" aria-label={label} title={label} {onclick}>
  <Settings2 class="size-3.5" aria-hidden="true" />
  Configure
</Button>
