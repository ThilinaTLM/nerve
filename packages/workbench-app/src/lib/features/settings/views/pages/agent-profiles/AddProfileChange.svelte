<!-- "Add a change": pick which setting to change; its value is chosen next. -->
<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Plus from "@lucide/svelte/icons/plus";
import Popover, {
  PopoverBody,
  PopoverHeader,
  SelectRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import { changeKinds, type ChangeKey } from "./profile-changes";

type Props = {
  profileLabel: string;
  /** Changes the profile already has; a setting appears once. */
  taken: ChangeKey[];
  onPick: (kind: (typeof changeKinds)[number]["key"]) => void;
};
let { profileLabel, taken, onPick }: Props = $props();
let open = $state(false);
const kinds = $derived(
  changeKinds.filter((kind) =>
    kind.key === "tool" ? true : !taken.includes(kind.key),
  ),
);
</script>

<Popover
  bind:open
  size="sm"
  side="top"
  align="start"
  ariaLabel={`Add a change to ${profileLabel}`}
  triggerClass={buttonVariants({ variant: "ghost", size: "sm" })}
>
  {#snippet trigger()}
    <Plus class="size-3" aria-hidden="true" />
    Add a change
  {/snippet}
  <PopoverHeader title="Change which setting?" />
  <PopoverBody>
    {#each kinds as kind (kind.key)}
      <SelectRow
        label={kind.label}
        onclick={() => {
          open = false;
          onPick(kind.key);
        }}
      >
        {#snippet trailing()}
          <ChevronRight
            class="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        {/snippet}
      </SelectRow>
    {/each}
  </PopoverBody>
</Popover>
