<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  /** The parent page, e.g. "Extensions"; it is the back link. */
  pageLabel: string;
  /** The open item, e.g. "Atlassian". */
  itemLabel: string;
  onBack: () => void;
};

let { pageLabel, itemLabel, onBack }: Props = $props();
</script>

<nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-1 text-ui">
  <Button
    variant="ghost"
    size="sm"
    class="-ml-2"
    title={`Back to ${pageLabel}`}
    onclick={onBack}
  >
    <ChevronLeft class="size-3.5" aria-hidden="true" />
    {pageLabel}
  </Button>
  <ChevronRight
    class="size-3.5 flex-none text-muted-foreground"
    aria-hidden="true"
  />
  <span class="min-w-0 truncate font-medium text-foreground" aria-current="page"
    >{itemLabel}</span
  >
</nav>
